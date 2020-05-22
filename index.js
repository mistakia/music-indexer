const fs = require('fs')
const fsPromises = fs.promises
const path = require('path')
const fpcalc = require('fpcalc')
const Knex = require('knex')
const debug = require('debug')
const musicMetadata = require('music-metadata')
const { sha256 } = require('crypto-hash')
const config = require('./config')
const level = require('level')

const log = debug('indexer')
log.log = console.log.bind(console)
const logError = debug('indexer:error')
debug.enable('indexer')

const queuedb = level(config.queuedb)
const completeddb = level(config.completeddb)
const db = Knex(config.mysql)
let started = false
let loaded = false

const getAcoustID = (filepath, options = {}) => {
  return new Promise((resolve, reject) => {
    fpcalc(filepath, options, (err, result) => {
      if (err) return reject(err)
      resolve(result)
    })
  })
}

const getNext = () => new Promise((resolve, reject) => {
  const it = queuedb.iterator()
  it.next((error, key, value) => {
    if (error) {
      return reject(error)
    }
    resolve(key)
  })
})

const run = async () => {
  const filepath = await getNext()

  if (!filepath) {
    started = false

    if (loaded) {
      process.exit()
    }
    return
  }

  log(`indexing ${filepath}`)

  const finish = async () => {
    await queuedb.del(filepath)
    run()
  }

  try {
    const stat = fs.statSync(filepath)
    const { size } = stat
    const content = fs.readFileSync(filepath)
    const hash = await sha256(content)
    const tracks = await db('tracks').where({ hash })
    if (tracks.length) {
      await db('files').insert({
        filepath,
        trackid: tracks[0].id,
        size
      })
      return finish()
    }

    let fid = null
    try {
      const acoustid = await getAcoustID(filepath)
      fid = await sha256(acoustid.fingerprint)
    } catch (error) {
      //
    }

    const metadata = await musicMetadata.parseFile(filepath)
    let picture = metadata.common.picture.length
      ? await sha256(metadata.common.picture[0].data.toString('base64'))
      : null

    const track = await db('tracks').insert({
      hash,
      fid,
      year: metadata.common.year || null,
      title: metadata.common.title || null,
      artist: metadata.common.artist || null,
      album: metadata.common.album || null,
      date: metadata.common.date || null,
      originaldate: metadata.common.originaldate || null,
      comment: metadata.common.comment
        ? metadata.common.comment.join(',') : null,
      website: metadata.common.website || null,
      notes: metadata.common.notes
        ? metadata.common.notes.join(',') : null,
      bpm: metadata.common.bpm || null,
      key: metadata.common.key || null,

      picture,

      container: metadata.format.container || null,
      codec: metadata.format.codec || null,
      codecProfile: metadata.format.codecProfile || null,
      duration: metadata.format.duration || null,
      bitrate: metadata.format.bitrate || null
    })

    await db('files').insert({
      filepath,
      trackid: track[0],
      size
    })
  } catch (error) {
    const e = error.toString()
    if (
      !e.includes('ER_DUP_ENTRY')
        && !e.includes('Cannot read property \'length\' of undefined')
    ) {
      logError(error)
    }
    await completeddb.put(filepath, e.toString())
  }

  return finish()
}

const start = () => {
  if (started) {
    return
  }
  started = true
  run()
}

const walk = async (dir, { filelist = [], dirlist = [], onFile } = {}) => {
  const files = await fsPromises.readdir(dir)

  for (const file of files) {
    const filepath = path.join(dir, file)
    const stat = await fsPromises.stat(filepath)

    if (stat.isDirectory()) {
      dirlist.push(filepath)
      const data = await walk(filepath, { filelist, dirlist, onFile })
      filelist = data.filelist
      dirlist = data.dirlist
    } else {
      filelist.push(filepath)
      try {
        await completeddb.get(filepath)
        await queuedb.get(filepath)
      } catch (error) {
        await queuedb.put(filepath, true)
        start()
      }
    }
  }

  return { filelist, dirlist }
}


const main = async () => {
  await queuedb.open()
  await completeddb.open()

  for (const dir of config.dirs) {
    await walk(dir)
  }

  loaded = true
}

main()

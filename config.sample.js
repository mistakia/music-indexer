const path = require('path')

module.exports = {
  dirs: [ ],
  leveldb: path.resolve(__dirname, './queue'),
  mysql: {
    client: 'mysql',
    connection: {
      host: 'localhost',
      user: 'root',
      database: 'music'
    }
  }
}

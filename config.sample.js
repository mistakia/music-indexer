const path = require('path')

module.exports = {
  dirs: [ ],
  queuedb: path.resolve(__dirname, './queue'),
  completeddb: path.resolve(__dirname, './completed'),
  mysql: {
    client: 'mysql',
    connection: {
      host: 'localhost',
      user: 'root',
      database: 'music'
    }
  }
}

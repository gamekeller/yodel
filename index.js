import pmx from 'pmx'
import fs from 'fs'
import path from 'path'
import Redis from 'ioredis'
import tunnel from 'tunnel-ssh'
import teamspeak from './lib/client'
import rpc from './lib/rpc'
import cfg from './lib/config'

pmx.init()

let config = cfg('YODEL')

function init (err) {
  if (err) return console.error('✗ Unable to establish SSH tunnel.', err)
  if (config.tunnel.active) console.log('✔ SSH tunnel established.')

  let redis = new Redis(config.redis.port, config.redis.host, { keyPrefix: 'YDL:' })
    .on('connect', () => console.log('✔ Redis connection established.'))
    .on('error', () => console.error('✗ Unable to connect to Redis.'))

  teamspeak.connect(config.teamspeak)
    .on('connect', () => console.log('✔ TeamSpeak Server Query connection established.'))
    .on('error', () => console.error('✗ Unable to connect to the TeamSpeak Server Query.'))

  rpc.listen(config.port)
  console.log(`✔ RPC server listening on port ${ config.port }.`)

  fs.readdir(path.join(__dirname, 'modules'), (err, files) => {
    for (let file of files) {
      let YodelModule = require(path.join(__dirname, 'modules', file)).default
      let moduleConfig = config.modules[path.basename(file, '.js')]
      new YodelModule(teamspeak, redis, moduleConfig)
    }
  })
}

if (config.tunnel.active) {
  tunnel({
    host: config.tunnel.host,
    dstPort: config.tunnel.port,
    username: config.tunnel.user,
    password: config.tunnel.pass
  }, init)
} else {
  init()
}

import pmx from 'pmx'
import fs from 'fs'
import path from 'path'
import Redis from 'ioredis'
import teamspeak from './lib/client'
import rpc from './lib/rpc'
import cfg from './lib/config'

pmx.init()

let config = cfg('YODEL')

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
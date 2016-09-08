import pmx from 'pmx'
import fs from 'fs'
import path from 'path'
import Redis from 'ioredis'
import teamspeak from './lib/client'
import cfg from './lib/config'

pmx.init()

let config = cfg('YODEL')

let redis = new Redis(config.redis.port, config.redis.host, { keyPrefix: 'YDL:', dropBufferSupport: true })
  .on('connect', () => console.log('✔ Redis connection established.'))
  .on('error', () => console.error('✗ Unable to connect to Redis.'))

teamspeak.connect(config.teamspeak)
  .on('connect', () => console.log('✔ TeamSpeak Server Query connection established.'))
  .on('error', () => console.error('✗ Unable to connect to the TeamSpeak Server Query.'))

fs.readdir(path.join(__dirname, 'modules'), (err, files) => {
  for (let file of files) {
    let moduleName = path.basename(file, '.js')
    if (!config.modules[moduleName] || !config.modules[moduleName]['@enabled']) continue
    let YodelModule = require(path.join(__dirname, 'modules', file)).default
    let moduleConfig = config.modules[moduleName]
    new YodelModule(teamspeak, redis, moduleConfig)
  }
})
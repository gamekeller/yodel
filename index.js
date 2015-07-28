import pmx from 'pmx'
import redis from 'redis'
import tunnel from 'tunnel-ssh'
import teamspeak from './lib/client'
import Monitor from './lib/monitor'
import rpc from './lib/rpc'

pmx.init()

let config = require('./lib/config')('YODEL')

function init (err) {
  if (err) return console.error('✗ Unable to establish SSH tunnel.', err)
  if (config.tunnel.active) console.log('✔ SSH tunnel established.')

  let redisClient = redis.createClient(config.redis.port, config.redis.host)
    .on('connect', () => console.log('✔ Redis connection established.'))
    .on('error', () => console.error('✗ Unable to connect to Redis.'))

  teamspeak.connect(config.teamspeak)
    .on('connect', () => console.log('✔ TeamSpeak Server Query connection established.'))
    .on('error', () => console.error('✗ Unable to connect to the TeamSpeak Server Query.'))

  rpc.listen(config.port)
  console.log(`✔ RPC server listening on port ${ config.port }.`)

  new Monitor(teamspeak, redisClient)
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

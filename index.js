import redis from 'redis'
import config from './lib/config'
import teamspeak from './lib/client'
import Monitor from './lib/monitor'
import rpc from './lib/rpc'

let redisClient = redis.createClient()
  .on('connect', () => console.log('✔ Redis connection established.'))
  .on('error', () => console.error('✗ Unable to connect to Redis.'))

teamspeak.connect(config.teamspeak)
  .on('connect', () => console.log('✔ TeamSpeak Server Query connection established.'))
  .on('error', () => console.error('✗ Unable to connect to the TeamSpeak Server Query.'))

rpc.listen(config.port)
console.log(`✔ RPC server listening on port ${ config.port }.`)

let monitor = new Monitor(teamspeak, redisClient)
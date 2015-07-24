import dnode from 'dnode'
import client from './client'

export default dnode({
  findByNickname: (pattern, cb) => {
    client.findByNickname(pattern).then(
      data => cb(null, data),
      err => cb(err)
    )
  }
})

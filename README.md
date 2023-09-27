# NowPlaying

WebSocket API for getting the currently playing song on Spotify.

Production instance at [https://spotify.antti.codes/](https://spotify.antti.codes/)

## Todo

- Create ToS & Privacy Policy
- Do whatever the Spotify terms ask for
- Apply for extended quota mode to allow others to sign up
  - For now you can ask me I guess...

## Documentation

### Authentication

Open the website and login with Spotify.

### Rest API

The REST API provides a single endpoint `/api/np/:id` which is meant for occasional data fetching
and is therefore heavily ratelimited.

### Websocket

Communication happens in JSON. `op` being the opcode and `d` being any data associated with the message. Example implementation can be found on [my very own website](https://github.com/Chicken/antti.codes).

#### The protocol

1. Connect to `wss://spotify.antti.codes/`
2. Server responds with opcode 1 and `heartbeat_interval` which is interval in milliseconds to send the heartbeat (opcode 3) in

```json
{
  "op": 1,
  "d": {
    "heartbeat_interval": 15000
  }
}
```

```json
{
  "op": 3
}
```

3. You respond with opcode 2 and user id string as data

```json
{
  "op": 2,
  "d": "qgfht3wu1vo4ajn8skj9ugxem"
}
```

4. Server starts sending opcode 0 with the users now playing status

```json
{
  "op": 0,
  "d": {
    "is_playing": false
  }
}
```

```json
{
  "op": 0,
  "d": {
    "is_playing": true,
    "song": "Song name",
    "album": "Album name",
    "artist": "Artist name(s)",
    "album_art": "Album art url",
    "track_id": "Track id",
    "total": 223, // Total track length (seconds)
    "start": 1695837181 // Play start unix timestamp (seconds)
}
```

The server might also send opcode 4 with a message indicating an error.
After sending opcode 4 the server will close the connection.

```json
{
  "op": 4,
  "d": "No heartbeat received"
}
```

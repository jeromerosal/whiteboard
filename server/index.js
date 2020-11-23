const config = require('./config.js');
const io = require('socket.io')(
    config.port, {
    path: config.path,
    serveClient: false,
    cors: {
        origin: config.origin,
    }
});
let rooms = {
    public: 'public',
    private: []
}

io.on('connection', function(socket) {
    //Default room to join is public
    let room = rooms.public;
    socket.join(room);
    socket.emit('id', socket.id);
    if(config.debug)
        console.log(`User connected to a room: ${socket.id}`);
    socket.on('update', (data) => {
        if(config.debug)
            console.log(`User: ${socket.id} Data: ${JSON.stringify(data)}`);
        socket.in(room).broadcast.emit('updates', data);
    });
    socket.on('disconnect', function () {
        if(config.debug)
            console.log(`User disconnected to a room: ${socket.id}`);
        socket.in(room).broadcast.emit('disconnected', socket.id);
    });
});


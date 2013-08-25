#!/usr/bin/env node

var app = require('http').createServer(handler)
  , io = require('socket.io').listen(app)
  , fs = require('fs')

var TinyG = require("../../tinyg");

var g = new TinyG();
port=8082;
app.listen(port);
console.log("Open your browser to http://localhost:"+port);


function handler (req, res) {
  var filename = '/index.html';

  if (req.url.match(/\/lib\/.*\.js/)) {
    filename = req.url;
    res.setHeader("Content-Type", "application/javascript");
  }

  fs.readFile(__dirname + filename,
  function (err, data) {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading index.html');
    }

    res.writeHead(200);
    res.end(data);
  });
}

io.sockets.on('connection', function (socket) {
  g.useSocket(socket);
});


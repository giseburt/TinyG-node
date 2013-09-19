#!/usr/bin/env node

var express = require('express')
  , app = express()
  , server = require('http').createServer(app)
  , io = require('socket.io').listen(server)
  , fs = require('fs')
  , TinyG = require("../../tinyg");


port=8082;
server.listen(port);
console.log("Open your browser to http://localhost:"+port);

var g = new TinyG();

app.get('/', function (req, res) {
	var index_name = req.query.three ? '/index-three.html' : '/index-raphael.html';
  res.sendfile(__dirname + index_name);
});

app.use('/lib', express.static(__dirname + '/lib'));

io.sockets.on('connection', function (socket) {
  g.useSocket(socket);
});


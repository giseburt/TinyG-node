var socket = io.connect();//'http://localhost'

// This will be broken into it's own module soon:

function TinyG() {
	var self = this;
	
	this._configuration = {};
	this._status = {};
  
	var _merge = function (to, from) {
		for (var n in from) {
			if (to[n] === null || typeof to[n] != 'object') {
				to[n] = from[n];
			} else if (typeof from[n] == 'object') {
				to[n] = _merge(to[n], from[n]);
			} // if (is not object) ... else
		} // for (n in from)
		return to;
	};

	socket.on('connect', function() {
		self.emit('getStatus', function(status) {
			// We will REPLACE the _status with this other object!
			// If these is aything to preserve, here's the place to do it. (We don't.)
			self._status = status;
		});
		self.emit('getConfiguration', function(config) {
			// Same: Replace ... preserve here. (We don't.)
			self._configuration = config;
		});
	});
	
	socket.on('data', function(data) {
		// Debugging
		// console.log("RAW: "+data);
		self.emit('data', data);
	});
	socket.on('error', function(data) {
		console.log("error: "+JSON.stringify(data));
		// self.emit('data', data);
	});
	socket.on('configChanged', function(changed) {
		_merge(self._configuration, changed);
		// console.log("configChanged: "+JSON.stringify(changed));
		self.emit('configChanged', changed);
	});
	socket.on('statusChanged', function(changed) {
		_merge(self._status, changed);
		// console.log("statusChanged: "+JSON.stringify(changed));
		self.emit('statusChanged', changed);
	});
  socket.on('gcodeReceived', function(gc) {
		// console.log("gcodeReceived: "+JSON.stringify(gc));
		self.emit('gcodeReceived', gc);
	});
  socket.on('list', function(results) {
		console.log("got list: "+JSON.stringify(results));
		self.listResults = results;
		self.emit('list', results);
	});
}
TinyG.prototype.list = function(callback) {
	if (callback !== undefined)
		socket.once('list', callback);

	// Request the other side to "list"
	socket.emit('list');
};

TinyG.prototype.open = function(port) {
	// Request the other side to "open"
	socket.emit('open', port);
}
TinyG.prototype.close = function() {
	// Request the other side to "close"
	socket.emit('close');
}

TinyG.prototype.write = function(data) {
	// Request the other side to "write"
	socket.emit('write', data);
}

TinyG.prototype.sendFile = function(path) {
	// Request the other side to "sendFile"
	socket.emit('sendFile', path);
}

TinyG.prototype.readFile = function(path) {
	// Request the other side to "readFile"
	socket.emit('readFile', path);
}


io.util.mixin(TinyG, io.EventEmitter);
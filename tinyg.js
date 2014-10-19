var EventEmitter = require('events').EventEmitter;
var util = require('util');
var fs = require('fs');

//var spawn = require('child_process').spawn;
var SerialPortModule = require("serialport"),
    SerialPort = SerialPortModule.SerialPort;

function TinyG() {
  // Squirrel away a ref to 'this' for use in callbacks.
  var self = this;

  //predefine
  var serialPortControl = null;
  this.serialPortControl = serialPortControl;

  var serialPortData = null;
  this.serialPortData = serialPortData;

  var readBuffer = "";
  var _tinygParser = function (emitter, buffer) {
    // Collect data
    readBuffer += buffer.toString();

    // Split collected data by line endings
    var parts = readBuffer.split(/(\r\n|\r|\n)+/);

    // If there is leftover data,
    readBuffer = parts.pop();

    parts.forEach(function (part) {
      // Cleanup and remove blank or all-whitespace lines.
      if (part.match(/^\s*$/))
        return;

      // Remove stray XON/XOFF charaters that make it through the stream.
      part = part.replace(/([\x13\x11])/, "");

      // Mark everything else with a bullet
      // console.log('part: ' + part.replace(/([\x00-\x20])/, "•"));

      emitter.emit('data', part);

      if (part[0] == "{" /* make the IDE happy: } */) {
        try {
          jsObject = JSON.parse(part);
        } catch(err) {
          console.log('### ERROR: ', err);
          console.log('### ERROR was parsing: ', part);
          return;
        }

        // We have to look in r/f for the footer due to a bug in TinyG...
        var footer = jsObject.f || (jsObject.r && jsObject.r.f);
        if (footer !== undefined) {
          if (footer[1] !== 0) {
            console.error("ERROR: TinyG reported a parser error reading '%s': %d (based on %d bytes read and a checksum of %d)", JSON.stringify(jsObject.r), footer[1], footer[2], footer[3]);
          }

          // Remove the object so it doesn't get parsed anymore
          delete jsObject.f;
          if (jsObject.r) {
            delete jsObject.r.f;
          }
        }

        var jsObject = jsObject.r || jsObject;
        var changed = null;
        // console.log(util.inspect(jsObject));
        if (jsObject.hasOwnProperty('sr')) {
          // changed = self._mergeIntoState(jsObject.sr);
          // if (Object.keys(changed).length > 0) {
            self.emit("statusChanged", jsObject.sr);
          // }
        }
        else if (jsObject.hasOwnProperty('gc')) {
          self.emit("gcodeReceived", jsObject.gc);
        }
        else if (jsObject.hasOwnProperty('qr')) {
          self.emit("qrReceived", jsObject); // Send the whole thing -- qr is a sibling of others in the report
        }
        else {
          // changed = self._mergeIntoConfiguration(jsObject);
          // if (Object.keys(changed).length > 0) {
            self.emit("configChanged", jsObject);
          // }
        }

        // console.log("Conf: " + JSON.stringify(self._configuration));
        // console.log("Stat: " + util.inspect(self._status));
      }
    } // parts.forEach function
    ); // parts.forEach
  }; // _tinygParser;

  this._baseOptions = {
    baudRate: 115200,
    flowcontrol: ['RTSCTS'],
    // Provide our own custom parser:
    parser: _tinygParser
  };

  Object.defineProperty(this, "configuration", {
    get: function() { return self._configuration; },
    // Setter? There's no setter...
    configurable : false, // We can *not* delete this property.
    enumerable : true // We want this one to show up in enumeration lists.
  });

  Object.defineProperty(this, "status", {
    get: function() { return self._status; },
    // Setter? There's no setter...
    configurable : false, // We can *not* delete this property.
    enumerable : true // We want this one to show up in enumeration lists.
  });
}

util.inherits(TinyG, EventEmitter);

TinyG.prototype.open = function (path, options) {
  var self = this;
  if (self.serialPortControl !== null) {
    throw new Error("Unable to open TinyG at path '" + path + "' -- TinyG already open.");
  }
  options = options || {};
  for (key in self._baseOptions) {
    options[key] = options[key] || self._baseOptions[key];
  }

  // console.log(util.inspect(options));
  self.dataPortPath = options.dataPortPath;
  self.serialPortControl = new SerialPort(path, options);

  self.serialPortControl.on("open", function () {
    // self._status.open = true;
    // self._status.openPort = path;

    // spawn('/bin/stty', ['-f', path, 'crtscts']);
    self.serialPortControl.on('data', function(data) {
      self.emit("data", data);
    });

    process.nextTick(function() {
      self.write({ee:0}); //Set echo off, it'll confuse the parser
      self.write({ex:2}); //Set flow control to 1: XON, 2: RTS/CTS
      self.write({jv:4}); //Set JSON verbosity to 5 (max)
      self.write({qv:2}); //Set queue report verbosity
      self.write(
      {
        sr:{
          "posx":true,
          "posy":true,
          "posz":true,
          "posa":true,
          "feed":true,
          "vel":true,
          "unit":true,
          "coor":true,
          "dist":true,
          "frmo":true,
          "stat":true
        }
      });

      // get the status report and queue report
      self.write({sr:null});

      self.emit('open');
    })
  });

  self.serialPortControl.on("error", function(err) {
    self.emit("error", {serialPortError:err});
  });

  self.serialPortControl.on("close", function(err) {
    self.serialPortControl = null;

    // self._status.open = false;
    // self._status.openPort = null;

    self.emit("close", err);
  });
};

TinyG.prototype.close = function() {
  var self = this;
  if (!self.serialPortControl === null)
    self.serialPortControl.close();

  if (!self.serialPortData === null)
    self.serialPortData.close();

  // 'close' event will set self.serialPortControl = null.
};

var writeCallback = function (err, results) {
  if (err)
    console.error("WRITE ERROR: ", err);
}

TinyG.prototype.write = function(value, callback) {
  var self = this;

  if (callback === undefined)
    callback = writeCallback;

  if (self.serialPortControl === null)
    return;

  if (typeof value !== "string") {
      console.log("###WRITEjs: '%s'", JSON.stringify(value))
      self.serialPortControl.write(JSON.stringify(value) + '\n', callback);
  }
  else { // It's a string:
    if (value.match(/[\n\r]$/) === null)
      value = value + "\n";

    if (self.serialPortData === null || value.match(/^{}?/)) { // BTW: The optional close bracket is to appears the editor.
      // console.log("###WRITE: '%s'", value)
      self.serialPortControl.write(value, callback);
      // self.serialPortControl.drain(writeCallback);
    } else {
      // console.log("***WRITE: '%s'", value)
      self.serialPortData.write(value, callback);
    }
  }
};

TinyG.prototype.sendFile = function(filename) {
  var self = this;

  var readBuffer = "";
  var fileSize = fs.statSync(filename).size;

  var dataChannel = self.serialPortControl;

  if (self.dataPortPath) {
    self.serialPortData = new SerialPort(self.dataPortPath, self._baseOptions);

    self.serialPortData.on("open", function () {
      self.serialPortData.on('data', function(data) {
        // This should NEVER happen!!
        // The data channel should never get data back.
        self.emit("data", data);
      });

      dataChannel = self.serialPortData;

      self.emit("dataChannelReady");
    });

    self.serialPortData.on("error", function(err) {
      self.emit("error", {serialPortDataError:err});
    });

    self.serialPortData.on("close", function(err) {
      self.serialPortData = null;
    });
  } else {
    self.emit("dataChannelReady");
  }

  self.on('dataChannelReady', function () {
    var readStream = fs.createReadStream(filename);

    readStream.on('error', function(err) {
      console.log(err);
      throw err;
    });


    self.write({qr:null});

    var lineCountToSend = 0;
    var lineCountSent = 0; // sent since the last qr
    var lineBuffer = [];

    function sendLines() {
      console.log("lineCountToSend: %d, lineCountSent: %d, lineBuffer.length: %d", lineCountToSend, lineCountSent, lineBuffer.length);

      while (lineBuffer.length > 0 && (lineCountToSend - lineCountSent) > 0) {
        var line = lineBuffer.shift();
        self.write(line);
        self.parseGcode(line, readFileState);

        lineCountSent++;
        console.log("lineCountToSend: %d, lineCountSent: %d, lineBuffer.length: %d", lineCountToSend, lineCountSent, lineBuffer.length);
      }

      // if (lineBuffer.length > 200) {
      //   readStream.pause();
      // } else if (lineBuffer.length < 20) {
      //   readStream.resume();
      // }
    }

    readStream.on('data', function(data) {
      readBuffer += data.toString();

      // Split collected data by line endings
      var lines = readBuffer.split(/(\r\n|\r|\n)+/);

      // If there is leftover data,
      readBuffer = lines.pop();

      readFileState = {};

      lines.forEach(function (line) {
        // Cleanup and remove blank or all-whitespace lines.
        // TODO:
        // * Handle relative QRs (when available)
        // * Ability to stop or pause
        // * Rewrite and map line numbers

        if (line.match(/^\s*$/))
          return;

        lineBuffer.push(line);
      });

      sendLines();
    }); // readStream.on('data', ... )


    self.on('qrReceived', function(qr) {
      console.log(qr);
      if (qr.qi == null && qr.qo == null) {
        lineCountToSend = qr.qr;
      }
      if (qr.qi) {
        lineCountToSend -= qr.qi;
      }
      if (qr.qo) {
        lineCountToSend += qr.qo;
      }

      lineCountSent = 0;

      sendLines();
    }); // self.on('qrReceived', ... )

  }); // self.on('dataChannelReady', ... )
};

var VALID_CMD_LETTERS = ["m","g","t"];
var ABSOLUTE = 0;
var RELATIVE = 1;

function _valueFromString(str) {
  return str.substring(1).replace(/^\s+|\s+$/g, '').replace(/^0+?(?=[0-9]|-)/,'');
}

TinyG.prototype.parseGcode = function(line, readFileState) {
  var self = this;

  line = line.replace(/^\s+|\s+$/g, '').replace(/(;.*)|(\(.*?\))| /g , '').toLowerCase();

  var attributes = {};

  var attributes_array = line.split(/(?=[a-z])/);
  if (attributes_array.length != 0) {
    if (attributes_array[0][0] == 'n') {
      readFileState.line = _valueFromString(attributes_array[0]);
      attributes_array.shift();
    }
  }

  if (attributes_array.length != 0) {
    for (var i = 0; i < VALID_CMD_LETTERS.length; i++) {
      if (attributes_array[0][0] == VALID_CMD_LETTERS[i]) {
        readFileState.command = {};
        readFileState.command[attributes_array[0][0]] = _valueFromString(attributes_array[0]);

        attributes_array.shift();
        break;
      }
    };

    for (var i = 0; i < attributes_array.length; i++) {
      var attr = attributes_array[i];
      attributes[attr[0]] = _valueFromString(attr);
    };

    self.emit("sentGcode", {cmd: readFileState.command, values: attributes});
  }
};

TinyG.prototype.list = function(callback) {
  SerialPortModule.list(function (err, results) {
    if (err) {
      callback(err, null);
      return;
    }

    var tinygs = [];

    for (var i = 0; i < results.length; i++) {
      var item = results[i];

      if (process.platform === 'win32') {
        // Windows:
        // TBD
      } else if (process.platform === 'darwin') {
        // MacOS X:
        //  Command: { comName: '/dev/cu.usbmodem001', manufacturer: 'Synthetos', serialNumber: '002', pnpId: '', locationId: '0x14530000', vendorId: '0x1d50', productId: '0x606d' }
        //     Data: { comName: '/dev/cu.usbmodem003', manufacturer: '', serialNumber: '', pnpId: '', locationId: '', vendorId: '', productId: '' }

        // console.log(util.inspect(item));

        if (item.manufacturer == 'FTDI') {
          tinygs.push({path: item.comName});
        } else if (item.manufacturer == 'Synthetos') {
          tinygs.push({path: item.comName});
        } else if (item.manufacturer == '') {
          if (tinygs.length > 0 && (x = tinygs[tinygs.length-1].path.match(/^(.*?)([0-9]+)/)) && (y = item.comName.match(/^(.*?)([0-9]+)/)) && x[1] == y[1]) {
            x[2] = parseInt(x[2]);
            y[2] = parseInt(y[2]);

            if (((x[2] == 1) && (y[2] == 3)) || (x[2]+1 == y[2])) {
              tinygs[tinygs.length-1].dataPortPath = item.comName;
              continue;
            }
          }
        }
      } else {
        // Linux:
        //  Command: { comName: '/dev/ttyACM0', manufacturer: undefined, pnpId: 'usb-Synthetos_TinyG_v2_002-if00' }
        //     Data: { comName: '/dev/ttyACM1', manufacturer: undefined, pnpId: 'usb-Synthetos_TinyG_v2_002-if02' }
        if ((x = item.pnpId.match(/^usb-Synthetos_TinyG_v2_([0-9A-Fa-f]+)-if([0-9]+)/))) {
          if (tinygs.length > 0 && (y = tinygs[tinygs.length-1].pnpId.match(/^usb-Synthetos_TinyG_v2_([0-9A-Fa-f]+)-if([0-9]+)/)) && x[1] == y[1]) {
            tinygs[tinygs.length-1].dataPortPath = item.comName;
            continue;
          }

          tinygs.push({path: item.comName, pnpId: item.pnpId});
        }
      }

      // if (item.manufacturer == 'FTDI' || item.manufacturer == 'Synthetos') {
        // tinygOnlyResults.push(item);
      // }
    }

    callback(null, tinygs);
  })
};


// TinyG.prototype.useSocket = function(socket) {
//   var self = this;
//
//   self.on('open', function() { socket.emit('open'); });
//   self.on('error', function(err) { socket.emit('error', err); });
//   self.on('close', function(err) { socket.emit('close', err); });
//   self.on('data', function(data) { socket.emit('data', data); });
//
//   self.on('configChanged', function(changed) { socket.emit('configChanged', changed); });
//   self.on('statusChanged', function(changed) { socket.emit('statusChanged', changed); });
//   self.on('gcodeReceived', function(gc) { socket.emit('gcodeReceived', gc); });
//   self.on('unitChanged', function(unitMultiplier) { socket.emit('unitChanged', unitMultiplier); });
//
//   // Function proxies:
//   socket.on('open', function() { self.open.apply(self, arguments); });
//   socket.on('close', function() { self.close(); });
//   socket.on('write', function(data) { self.write(data); });
//   socket.on('sendFile', function(path) { self.sendFile(path); });
//   socket.on('readFile', function(path) { self.readFile(path); });
//   socket.on('list', function() {
//     self.list(function(err, results) {
//       if (err) {
//         socket.emit('error', err);
//         return;
//       }
//       // console.log("listing:" + results);
//       socket.emit('list', results);
//     });
//   });
//   socket.on('getStatus', function(callback) { callback(self._status); });
//   socket.on('getConfiguration', function(callback) { callback(self._configuration); });
//
// };

module.exports = TinyG;

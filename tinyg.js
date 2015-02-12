var EventEmitter = require('events').EventEmitter;
var util = require('util');
var fs = require('fs');
var Q = require('Q');
var RJSON = require("relaxed-json");


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
          jsObject = RJSON.parse(part);
        } catch(err) {
          self.emit('error', new TinyGError(util.format('### ERROR: %s parsing %s', err, part), {e: err, part: part}));
          return;
        }

        // We have to look in r/f for the footer due to a bug in TinyG...
        var footer = jsObject.f || (jsObject.r && jsObject.r.f);
        if (footer !== undefined) {
          if (footer[1] == 108) {
            self.emit('error', new TinyGError(
              util.format("ERROR: TinyG reported an syntax error reading '%s': %d (based on %d bytes read and a checksum of %d)", JSON.stringify(jsObject.r), footer[1], footer[2], footer[3]),
              jsObject
            ));
          }

          else if (footer[1] == 20) {
            self.emit('error', new TinyGError(
              util.format("ERROR: TinyG reported an internal error reading '%s': %d (based on %d bytes read and a checksum of %d)", JSON.stringify(jsObject.r), footer[1], footer[2], footer[3]),
              jsObject
            ));
          }

          else if (footer[1] == 202) {
            self.emit('error', new TinyGError(
              util.format("ERROR: TinyG reported an TOO SHORT MOVE on line %d", jsObject.r.n),
              jsObject
            ));
          }

          else if (footer[1] != 0) {
            self.emit('error', new TinyGError(
              util.format("ERROR: TinyG reported an error reading '%s': %d (based on %d bytes read and a checksum of %d)", JSON.stringify(jsObject.r), footer[1], footer[2], footer[3]),
              jsObject
            ));
          }

          // Remove the object so it doesn't get parsed anymore
          // delete jsObject.f;
          // if (jsObject.r) {
          //   delete jsObject.r.f;
          // }
        }

        var jsObject = jsObject.r || jsObject;

        self.emit("response", jsObject);

        if (jsObject.hasOwnProperty('sr')) {
          self.emit("statusChanged", jsObject.sr);
        }
        else if (jsObject.hasOwnProperty('gc')) {
          self.emit("gcodeReceived", jsObject.gc);
        }

        if (jsObject.hasOwnProperty('qr')) {
          self.emit("qrReceived", jsObject); // Send the whole thing -- qr is a sibling of others in the report
        }
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

  // Object.defineProperty(this, "configuration", {
  //   get: function() { return self._configuration; },
  //   // Setter? There's no setter...
  //   configurable : false, // We can *not* delete this property.
  //   enumerable : true // We want this one to show up in enumeration lists.
  // });
  //
  // Object.defineProperty(this, "status", {
  //   get: function() { return self._status; },
  //   // Setter? There's no setter...
  //   configurable : false, // We can *not* delete this property.
  //   enumerable : true // We want this one to show up in enumeration lists.
  // });
}

util.inherits(TinyG, EventEmitter);


function TinyGError(message, data) {
  Error.call(this);
  this.name = "TinyGError:";
  this.message = message || "TinyG Error: " + util.inspect(data, {depth: null});

  this.data = data;
};
util.inherits(TinyGError, Error);

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

    if (!options.dontSetup) {
      process.nextTick(function() {
        self.write("M2"); //Reset many settings
        self.write({ee:0}); //Set echo off, it'll confuse the parser
        self.write({ex:2}); //Set flow control to 1: XON, 2: RTS/CTS
        // self.write({jv:4}); //Set JSON verbosity to 5 (max)
        self.write({jv:2}); //Set JSON verbosity to 2 (medium)
        // self.write({qv:2}); //Set queue report verbosity
        self.write({qv:0}); //Set queue report verbosity (off)
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
            "stat":true,
            "line":true,
            // "gc":true,
            // "_cs1":true,
            // "_es1":true,
            // "_xs1":true,
            // "_fe1":true,
            // "_cs2":true,
            // "_es2":true,
            // "_xs2":true,
            // "_fe2":true
          }
        });

        // get the status report and queue report
        self.write({sr:null});

        self.emit('open');
      });
    } else {
      self.emit('open');
    }
  });

  self.serialPortControl.on("error", function(err) {
    self.emit("error", new TinyGError("SerialPort Error: " + util.inspect(err), {serialPortError:err}));
  });

  self.serialPortControl.on("close", function(err) {
    self.serialPortControl = null;

    self.emit("close", err);
  });
};

TinyG.prototype.close = function() {
  var self = this;

  // self.emit('error', util.format("tinyg.close(): ", self.serialPortControl, self.serialPortData));

  if (self.serialPortControl !== null) {
    // self.emit('error', util.format("Closing command channel."));
    self.serialPortControl.close();
    self.serialPortControl = null;
  }

  if (self.serialPortData !== null) {
    // self.emit('error', util.format("Closing data channel."));
    // self.serialPortData.close();
    self.serialPortData = null;
  }

  // 'close' event will set self.serialPortControl = null.
};

TinyG.prototype.defaultWriteCallback = function (err, results) {
  var self = this;

  if (err)
    self.emit('error', util.format("WRITE ERROR: ", err));
}

TinyG.prototype.write = function(value, callback) {
  var self = this;

  if (callback === undefined)
    callback = self.defaultWriteCallback;

  if (self.serialPortControl === null)
    return;

  if (typeof value !== "string") {
      // self.emit('error', util.format("###WRITEjs: '%s'", JSON.stringify(value)))
      self.serialPortControl.write(JSON.stringify(value) + '\n', callback);
  }
  else { // It's a string:
    if (value.match(/[\n\r]$/) === null)
      value = value + "\n";

    if (self.serialPortData === null || value.match(/^[{}!~%]/)) {
      // BTW: The optional close bracket ^^ is to appease the editor.

      // self.emit('error', util.format("###WRITE: '%s'", value))
      self.serialPortControl.write(value, callback);
      // self.serialPortControl.drain(writeCallback);
    } else {
      // self.emit('error', util.format("***WRITE: '%s'", value))
      self.serialPortData.write(value, callback);
    }
  }
};

TinyG.prototype.writeWithPromise = function(data, fullfilledFunction) {
  var self = this;

  // This will call write, but hand you back a promise that will be fulfilled
  // either once fullfilledFunction returns true OR, if fullfilledFunction is
  // null, when the "stat" in a status report comes back as 3 "STOP".

  // If data is an array, it will call write() for each element of the array.

  var deferred = Q.defer();

  if (fullfilledFunction === undefined || fullfilledFunction === null) {
    fullfilledFunction = function (r) {
      if (r && r['sr'] && r['sr']['stat'] && r['sr']['stat'] == 3) {
        return true;
      }

      return false;
    }
  }

  var respHandler = function (r) {
    deferred.notify(r);
    if (fullfilledFunction(r)) {
      try {
        deferred.resolve(r);
      } catch(e) {
        deferred.reject(e);
      }
    }
  }

  var errHandler = function(e) {
    deferred.notify(e);
  }

  self.on('response', respHandler);
  self.on('error', errHandler);
  // Uncomment to debug event handler removal
  // console.log("response l>", util.inspect(self.listeners('response'))); // [ [Function] ]
  // console.log("error l>", util.inspect(self.listeners('error'))); // [ [Function] ]


  if (util.isArray(data)) {
    data.forEach(function(v) {
      self.write(v);
    });
  } else {
    // console.log(">>>", toSend); // uncommment to debug writes
    self.write(data);
  }
  return deferred.promise.finally(function () {
    self.removeListener('response', respHandler);
    self.removeListener('error', errHandler);
  })
  // .progress(console.log) // uncomment to debug responses
  ;
};


TinyG.prototype.sendFile = function(filename_or_stdin, callback) {
  var self = this;

  var readBuffer = "";
  // var fileSize = fs.statSync(filename).size;

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
    var readStream;
    if (typeof filename_or_stdin == 'string') {
      console.warn("Opening file '%s' for streaming.", filename_or_stdin)
      readStream = fs.createReadStream(filename_or_stdin);
    } else {
      readStream = filename_or_stdin;
      readStream.resume();
    }

    readStream.on('error', function(err) {
      console.log(err);
      throw err;
    });


    // self.write({qr:null});

    var linesToStayAhead = 200;
    var lineCountToSend = linesToStayAhead;
    var lineCountSent = 0; // sent since the last qr
    var lineInLastSR = 0; // sent since the last qr
    var lineBuffer = []; // start it out ensuring that the machine is reset
    var totalLineCount = 0;
    var totalLinesSent = 0;
    var nextlineNumber = 0;
    var lastLineSent = 0;

    function sendLines() {
      // console.log("lineCountToSend: %d, lineCountSent: %d, lineBuffer.length: %d", lineCountToSend, lineCountSent, lineBuffer.length);

      while (lineBuffer.length > 0 && lineCountToSend-- > 0) {
        var line = lineBuffer.shift();
        self.write(line);
        lastLineSent = self.parseGcode(line, readFileState);

        lineCountSent++;
        totalLinesSent++;
        // console.log("lineCountToSend: %d, lineCountSent: %d, lineBuffer.length: %d", lineCountToSend, lineCountSent, lineBuffer.length);
      }

      // if (lineBuffer.length > 200) {
      //   readStream.pause();
      // } else if (lineBuffer.length < 20) {
      //   readStream.resume();
      // }

      self.emit('sendBufferChanged', {'lines': nextlineNumber, 'sent': lastLineSent});
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

        if (lineMatch = line.match(/^(?:[nN][0-9]+\s*)?(.*)$/)) {
          line = 'N' + nextlineNumber.toString() + " " + lineMatch[1];
          // self.emit('error', util.format(line));
          nextlineNumber++;
        }

        lineBuffer.push(line);
        totalLineCount++;
      });

      sendLines();
    }); // readStream.on('data', ... )

    readStream.on('end', function() {
      readStream.close();
    });

    // self.on('qrReceived', function(qr) {
    //   // console.log(qr);
    //   if (qr.qi == null && qr.qo == null) {
    //     lineCountToSend = qr.qr;
    //   }
    //   if (qr.qi) {
    //     lineCountToSend -= qr.qi;
    //   }
    //   if (qr.qo) {
    //     lineCountToSend += qr.qo;
    //   }
    //
    //   lineCountSent = 0;
    //
    //   sendLines();
    // }); // self.on('qrReceived', ... )


    self.on('statusChanged', function(sr) {
      // console.log("SR: ", sr);

      // See https://github.com/synthetos/TinyG/wiki/TinyG-Status-Codes#status-report-enumerations
      //   for more into about stat codes.

      if (sr.line)
        lineInLastSR = sr.line;

      // 3	program stop or no more blocks (M0, M1, M60)
      // 4	program end via M2, M30
      if (sr.stat == 3 || sr.stat == 4) {
        if (lineInLastSR == nextlineNumber-1) {
          if (callback) {
            // console.warn("DONE!!");
            callback();
          }
        } else {
          // Prime the pump -- it stalled
          lineCountToSend += 10;
          sendLines();
        }

      // 2	machine is in alarm state (shut down)
      } else if (sr.stat == 2) {
        // Fatal error! Shut down!
        self.close();
        callback("Fatal error!");
      } else if (sr.line) {
        if ((lastLineSent - sr.line) < (linesToStayAhead-lineCountToSend)) {
          lineCountToSend = linesToStayAhead - (lastLineSent - sr.line);
          sendLines();
        }
      }
    })

  }); // self.on('statusChanged', ... )
};

TinyG.prototype.get = function(key) {
  var self = this;

  return self.set(key, null);
};


TinyG.prototype.set = function(key, value) {
  var self = this;

  // Ok, we handle this differently.
  // If we are passed an object, such as {jv:1, ee:1} we will loop throught the
  // top-level keys and "set" each in turn, making a longer and longer promise
  // chain.

  // However, objects are unordered. So, if you pass it an array of objects,
  // we will loop through the array in order. So, you can pass this:
  // [{jv:1}, {qv:1}]


  if (util.isArray(key)) {
    var promiseChain = Q.fcall(function () {}); // Create a dummy promise to start the cahin.
    for (var k in key) {
      // We have to artificially create a function context to hold the values
      // so we make a closure function, assign the variables, and immediately call it.
      var closure = function (v) {
        promiseChain = promiseChain.then(function() {
          return self.set(v);
        }).catch(function (e) {
          console.log("Caught error setting ", v, ": ", e);
          return Q.fcall(function () {});
        });
      };
      closure(key[k]);
    };
    return promiseChain;

  } else if (typeof key === 'object') {
    var promiseChain = Q.fcall(function () {}); // Create a dummy promise to start the cahin.
    for (var k in key) {
      // We have to artificially create a function context to hold the values
      // so we make a closure function, assign the variables, and immediately call it.
      var closure = function (k, v) {
        promiseChain = promiseChain.then(function() {
          return self.set(k, v);
        }).catch(function (e) {
          console.log("Caught error setting {", k, ":", v, "}: ", e);
          return Q.fcall(function () {});
        });
      };
      closure(k, key[k]);
    };
    return promiseChain;
  }

  var deferred = Q.defer();

  var respHandler = function (r) {
    deferred.notify("got: " + util.inspect(r));
    if (key in r) {
      try {
        deferred.resolve(r[key]);
      } catch(e) {
        deferred.reject(e);
      }
    }
  }

  var errHandler = function(e) {
    deferred.reject(e);
    // deferred.resolve();
  }

  self.on('response', respHandler);
  self.on('error', errHandler);
  // Uncomment to debug event handler removal
  // console.log("response l>", util.inspect(self.listeners('response'))); // [ [Function] ]
  // console.log("error l>", util.inspect(self.listeners('error'))); // [ [Function] ]

  var toSend = {};
  toSend[key] = value;

  // console.log(">>>", toSend); // uncommment to debug writes
  self.write(toSend);

  return deferred.promise.finally(function () {
    self.removeListener('response', respHandler);
    self.removeListener('error', errHandler);
  })
  //.progress(console.log) // uncomment to debug responses
  ;
};


var VALID_CMD_LETTERS = ["m","g","t"];
var ABSOLUTE = 0;
var RELATIVE = 1;

function _valueFromString(str) {
  return str.substring(1).replace(/^\s+|\s+$/g, '').replace(/^0+?(?=[0-9]|-)/,'');
}

TinyG.prototype.parseGcode = function(line, readFileState) {
  var self = this;
  var rawLine = line;
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

    self.emit("sentGcode", {cmd: readFileState.command, values: attributes, line:readFileState.line, gcode: rawLine});
  }

  return readFileState.line;
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

            if (((x[2] == 1) && (y[2] == 3)) || (x[2]+1 == y[2]) || (x[2]+2 == y[2])) {
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


TinyG.prototype.openFirst = function (failIfMore) {
  var self = this;

  if (failIfMore === undefined || failIfMore === null) {
    failIfMore = false;
  }

  self.list(function (err, results) {
    if (err) {
      throw err;
    }

    if (results.length == 1 || (failIfMore == false && results.length > 0)) {
      if (results[0].dataPortPath) {
        return self.open(results[0].path, {dataPortPath : results[0].dataPortPath});
      } else {
        return self.open(results[0].path);
      }
    } else if (results.length > 1) {
      var errText = ("Error: Autodetect found multiple TinyGs:\n");

      for (var i = 0; i < results.length; i++) {
        var item = results[i];
        if (item.dataPortPath) {
          errText += ("\tFound command port: '%s' with data port '%s'\n", item.path, item.dataPortPath);
        } else {
          errText += ("\tFound port: '%s'\n", item.path);
        }
      }
      throw new TinyGError(errText, results);
    } else {
      throw new TinyGError("Error: Autodetect found no connected TinyGs.");
    }

  });
}

TinyG.prototype.stripGcode = function (gcode) {
  gcode = gcode.replace(/^(.*?);\(.*$/gm, "$1");
  gcode = gcode.replace(/[ \t]/gm, "");
  gcode = gcode.toUpperCase();
  return gcode;
}

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

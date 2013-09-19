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
  var serialPort = null;
  this.serialPort = serialPort;
  
  // Store the last sr
  this._status = {};
  this._lengthMultiplier = 1;
  
  // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty
  //  for a better explanation of Object.defineProperty.

  /*
   * We define getters and setters for "unit", that use the lengthMultiplier
   * to cleanly make sure all internal measurements are in mm.
   *
   * This should only be called from _mergeIntoState, since it *does not* change the TinyG setting.
   * This will be primrily called when a new status report (sr) comes in.
   *
   * On changing the value, an "unitChanged" event is emitted with the multiplier from mm as a parameter.
   */

  // self.state.unit returns with 0 for inches and 1 for mm, just like the TinyG JSON mode does.
  Object.defineProperty(this._status, "unit", {
    // We define the get/set keys, so this is an "accessor descriptor".
    get: function() { return self._lengthMultiplier == 25.4 ? 0 : 1; },
    set: function(newUnit) {
      var oldLM = self._lengthMultiplier;
      self._lengthMultiplier = (newUnit === 0 ? 25.4 : 1);

      if (self._lengthMultiplier != oldLM)
        self.emit("unitChanged", self._lengthMultiplier);
    },
    configurable : true, // We *can* delete this property. I don't know why though.
    enumerable : true // We want this one to show up in enumeration lists.
  });

  // self.state.unitMultiplier returns with the multiplier from mm, which is 1 for mm mode and 25.4 for inches mode.
  Object.defineProperty(this._status, "unitMultiplier", {
    // We define the get/set keys, so this is an "accessor descriptor".
    get: function() { return self._lengthMultiplier; },
    set: function(newUnitMultiplier) {
      if (newUnitMultiplier == 1 || newUnitMultiplier == 25.4) {
        var oldLM = self._lengthMultiplier;
        self._lengthMultiplier = newUnitMultiplier;

        if (self._lengthMultiplier != oldLM)
          self.emit("unitChanged", self._lengthMultiplier);
      }
    },
    configurable : true, // We *can* delete this property. I don't know why though.
    enumerable : true // We want this one to show up in enumeration lists.
  });
  
  // Store all of the config data
  this._configuration = {};
  
  function _setupConfigSchema(subconfig, subschema, subself, breadcrumbs) {
    var aliasMap = null;
    for (var n in subschema) {
      if (n == "_aliasMap") {
        aliasMap = subschema._aliasMap;
        continue;
      }
      
      var v = subschema[n];
      
      if (breadcrumbs === undefined) {
        breadcrumbs = [];
      }
      
      // Look for "objects," but arrays are objects, so we exclude ones with a '0' member.
      // This means a
      if (typeof subschema[n] == 'object' && !Array.isArray(subschema[n])) {
        subconfig[n] = {};
        subself[n] = {};
        
        // recurse
        breadcrumbs.push(n);
        _setupConfigSchema(subconfig[n], subschema[n], subself[n], breadcrumbs);
        breadcrumbs.pop();
      } else {
        // Normalize v to always be an array...
        if (!Array.isArray(v)) {
          v = [v];        
        }
        
        // Is this a normal value
        if (v[0] == "number" || v[0] == "string") {
          // Create the property, and init it as null.
          subconfig[n] = null;
        } // if "number" or "string"
        
        else
        // Is this a length?
        if (v[0] == "length") {
          // We need to force a new context, and for..in doesn't do that.
          // So we make a new function, and then call it immediately.
          (function(subconfig, n, newN) {
            
            // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty
            //  for a better explanation of what's happening here.
            
            // We squirrel away the actual value in _n
            Object.defineProperty(subconfig, newN, {
              value: undefined, // We give this a value, so it's a "data descriptor".
              writable : true,
              configurable : true,
              enumerable : false
            });

            /*
             * We define getters and setters for n, that use the lengthMultiplier
             * to cleanly make sure all internal measurements are in mm.
             */
            Object.defineProperty(subconfig, n, {
              // We define the get/set keys, so this is an "accessor descriptor".
              get: function() {
                // console.log("Get Length of key[%s]:", newN, sub[newN]);
                return subconfig[newN] === undefined ? undefined : subconfig[newN] / self._lengthMultiplier;
              },
              set: function(newLength) {
                // console.log("Set Length of key[%s] (lm: %d):", newN, self._lengthMultiplier, newLength);
                subconfig[newN] = newLength * self._lengthMultiplier;
              },
              configurable : true, // We *can* delete this property. I don't know why though.
              enumerable : true // We want this one to show up in enumeration lists.
            });

          })(subconfig, n, "_"+n);
        } // if "length"
        
        else
        if (v[0] == "unit") {
          // We need to force a new context, and for..in doesn't do that.
          // So we make a new function, and then call it immediately.
          (function(subconfig, n) {
            /*
             * We define getters and setters for n, that use the lengthMultiplier
             * to cleanly make sure all internal measurements are in mm.
             */
            Object.defineProperty(subconfig, n, {
              // We define the get/set keys, so this is an "accessor descriptor".
              get: function() { return self._lengthMultiplier == 25.4 ? 0 : 1; },
              set: function(newUnit) {
                var oldLM = self._lengthMultiplier;
                self._lengthMultiplier = (newUnit === 0 ? 25.4 : 1);

                if (self._lengthMultiplier != oldLM)
                  self.emit("unitChanged", self._lengthMultiplier);
              },
              configurable : true, // We *can* delete this property. I don't know why though.
              enumerable : true // We want this one to show up in enumeration lists.
            });

          })(subconfig, n);
        } // if "unit"
        
        
        // For all values, create a setter and getter on self
        (function(subself, subconfig, n) {
          var request = {};
          var r = request;
          breadcrumbs.forEach(function(key){
            r[key] = {};
            r = r[key];
          });
          r[n]="";

          Object.defineProperty(subself, n, {
            // We define the get/set keys, so this is an "accessor descriptor".
            get: function() {
              console.log("Get:", JSON.stringify(request));
              self.write(request);
              
              // return the stale version
              return subconfig[n];
            },
            set: function(newvalue) {
              r[n]=newvalue;
              console.log("Set:", JSON.stringify(request));
              self.write(request);
            },
            configurable : true, // We *can* delete this property. I don't know why though.
            enumerable : true // We want this one to show up in enumeration lists.
          });
        })(subself, subconfig, n);
        

      } // (is object) else
      
    } // for (n in subschema)
    
    if (aliasMap !== null && aliasMap.match(/^[\*\%]$/)) {
      // We only support "*" or "%" type aliasMaps right now...

      /*
      * if breadcrumbs = ['x']
      * and subschema has a key 'vm'
      * them we make configuration['xvm'] (for "*") or configuration['vm'] (for "%")
      * a getter and setter for configuration['x']['vm']
      */

      var prefixKey = null;
      
      if (aliasMap == "*") {
        prefixKey = breadcrumbs.join('');
      } else if (aliasMap == "%") {
        prefixKey = "";
      }
      
      var aliasesToBaseString = breadcrumbs.join('/');
      
      for (n in subschema) {
        if (n.match(/^_/))
          continue;
        
        // We need to force a new context, and for..in doesn't do that.
        // So we make a new function, and then call it immediately.
        (function(conf, subconfig, valueKey, aliasKey, aliasesToString) {

          var request = {};
          var r = request;
          // This is the way it *should* work:
          /*
          breadcrumbs.forEach(function(key){
            r[key] = {};
            r = r[key];
          })
          r[valueKey]="";
          */

          // Due to a bug in TinyG <= 380.2, I have to set with the alias key itself.
          r[aliasKey]="";
          
          Object.defineProperty(conf, aliasKey, {
            // We define the get/set keys, so this is an "accessor descriptor".
            get: function() {
              // console.log("Alias getter %s called for %s", aliasKey, valueKey);
              return subconfig[valueKey];
            },
            set: function(newValue) {
              // console.log("Alias setter %s called for %s", aliasKey, valueKey);
              subconfig[valueKey] = newValue;
            },
            configurable : true, // We *can* delete this property. I don't know why though.
            enumerable : false // We *don't* want this alias to show up in enumeration lists.
          });
          
          Object.defineProperty(conf, aliasKey+"/aliasesTo", {
            // We define the get/set keys, so this is an "accessor descriptor".
            value: aliasesToString,
            configurable : true, // We *can* delete this property. I don't know why though.
            enumerable : false // We *don't* want this alias to show up in enumeration lists.
          });

          // For all values, create a setter and getter on self -- the TinyG object
          Object.defineProperty(self, aliasKey, {
            // We define the get/set keys, so this is an "accessor descriptor".
            get: function() {
              console.log("Get alias:", JSON.stringify(request), " aliasKey:", aliasKey);
              self.write(request);
              
              // return the stale version
              return subconfig[aliasKey];
            },
            set: function(newValue) {
              // r[valueKey]=newValue;
              r[aliasKey]=newValue;
              
              console.log("Set alias:", JSON.stringify(request));
              self.write(request);
            },
            configurable : true, // We *can* delete this property. I don't know why though.
            enumerable : true // We want this one to show up in enumeration lists.
          });
          
        })(self._configuration, subconfig, n, prefixKey+n, [aliasesToBaseString, n].join('/'));
        
        
      } // for (n in subschema) (for aliasMap)
    } // if (aliasMap...
  }

  try {
    var schema = require('./configSchema.json');
    
    _setupConfigSchema(this._configuration, schema, self);
  } catch(err) {
    self.emit('error', err);
  }

  var _merge = function (changed, to, from, changedRoot) {
    if (changedRoot === undefined) {
      changedRoot = changed;
    }

    for (var n in from) {
      if (to[n] === null || typeof to[n] != 'object') {
        // If the value changed, record it in the changed object
        if (to[n] != from[n]) {
          
          if (to[n+"/aliasesTo"] !== undefined) {
            var aliasMapFromRoot = to[n+"/aliasesTo"].split("/");
            var c = changedRoot;
            var key = null;
            while (aliasMapFromRoot.length > 1) {
              key = aliasMapFromRoot.shift();
              if (c[key] === undefined) {
                c[key] = {};
              }
              c = c[key];
            } // while
            key = aliasMapFromRoot.shift();
            c[key] = from[n];
          } else {
            changed[n] = from[n];
          }
          
        } // to != from

        // set the value, the mapping applies here
        to[n] = from[n];
      } else if (typeof from[n] == 'object') {
        if (changed[n] === undefined) {
          changed[n] = {};
        }
        
        to[n] = _merge(changed[n], to[n], from[n], changedRoot);

        // if the new object ended up empty, delete it
        if (changed[n] !== undefined && Object.keys(changed[n]).length === 0) {
          delete changed[n];
        }
      } // if (is not object) ... else
    } // for (n in from)

    return to;
  };

  this._mergeIntoState = function(jsonObj) {
    var changed = {};
    _merge(changed, this._status, jsonObj);
    return changed;
  };

  this._mergeIntoConfiguration = function(jsonObj) {
    var changed = {};
    _merge(changed, this._configuration, jsonObj);
    return changed;
  };

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
      console.log('part: ' + part.replace(/([\x00-\x20])/, "•"));
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
            console.error("ERROR: TinyG reported a parser error: %d (based on %d bytes read and a checksum of %d)", footer[1], footer[2], footer[3]);
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
          changed = self._mergeIntoState(jsObject.sr);
          if (Object.keys(changed).length > 0) {
            self.emit("statusChanged", changed);
          }
        }
        else if (jsObject.hasOwnProperty('gc')) {
            self.emit("gcodeReceived", jsObject.gc);
        }
        else {
          changed = self._mergeIntoConfiguration(jsObject);
          if (Object.keys(changed).length > 0) {
            self.emit("configChanged", changed);
          }
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
  if (self.serialPort !== null) {
    throw new Error("Unable to open TinyG at path '" + path + "' -- TinyG already open.");
  }
  options = options || {};
  for (key in self._baseOptions) {
    options[key] = options[key] || self._baseOptions[key];
  }
  
  console.log(util.inspect(options));
  self.serialPort = new SerialPort(path, options);
  
  self.serialPort.on("open", function () {
    self._status.open = true;
    self._status.openPort = path;

    // spawn('/bin/stty', ['-f', path, 'crtscts']);
    self.serialPort.on('data', function(data) {
      self.emit("data", data);
    });
    
    self.ex = 2; //Set flow control to 1: XON, 2: RTS/CTS
    self.ee = 0; //Set echo off, it'll confuse the parser
    self.jv = 4; //Set JSON verbosity to 5 (max)
    self.qv = 2; //Set queue report verbosity

    // get the status report
    self.write({sr:null});
    
    for (var key in self._configuration) {
      var req = {};
      req[key] = "";
      self.write(req); // Fetch each group
    }

    self.emit('open');
  });
  
  self.serialPort.on("error", function(err) {
    self.emit("error", {serialPortError:err});
  });
  
  self.serialPort.on("close", function(err) {
    self.serialPort = null;
    
    self._status.open = false;
    self._status.openPort = null;

    self.emit("close", err);
  });
};

TinyG.prototype.close = function() {
  var self = this;
  if (self.serialPort === null)
    return;
  
  self.serialPort.close();
  // 'close' event will set self.serialPort = null.
};

var writeCallback = function (err, results) {
  if (err)
    console.error("WRITE ERROR: ", err);
}

TinyG.prototype.write = function(value, callback) {
  var self = this;

  if (callback === undefined)
    callback = writeCallback;

  if (self.serialPort === null)
    return;
  
  if (typeof value !== "string") {
      // console.log("###WRITEjs: ", JSON.stringify(value))
      self.serialPort.write(JSON.stringify(value) + '\n', callback);
  }
  else { // It's a string:
    if (value.match(/[\n\r]$/) === null)
      value = value + "\n";

    // console.log("###WRITE: ", value)
      self.serialPort.write(value, callback);
  }
};

TinyG.prototype.sendFile = function(filename) {
  var self = this;

  var readBuffer = "";  
  var readStream = fs.createReadStream(filename);

  readStream.on('error', function(err) {
    console.log(err);
    throw err;
  });

  readStream.on('data', function(data) {
    readBuffer += data.toString();

    // Split collected data by line endings
    var parts = readBuffer.split(/(\r\n|\r|\n)+/);
    
    // If there is leftover data, 
    readBuffer = parts.pop();

    parts.forEach(function (part) {
      // Cleanup and remove blank or all-whitespace lines.
      // TODO:
      // * Handle relative QRs (when available)
      // * Ability to stop or pause
      // * Rewrite and map line numbers
      if (part.match(/^\s*$/))
        return;

      self.write(part);
    });
  });
};

var VALID_CMD_LETTERS = ["m","g","t"];
var ABSOLUTE = 0;
var RELATIVE = 1;

function _valueFromString(str) {
  return str.substring(1).replace(/^\s+|\s+$/g, '').replace(/^0+?(?=[0-9]|-)/,'');
}

TinyG.prototype.parseGcode = function(line, readFileState) {
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

    console.log({cmd: readFileState.command, values: attributes});
  }
};

TinyG.prototype.readFile = function(filename) {
  var self = this;

  var readFileState = {
    _path: filename,
    _mode: ABSOLUTE
  };

  var readBuffer = "";  
  var readStream = fs.createReadStream(filename);

  readStream.on('readable', function() {
    var data = readStream.read()

    readBuffer += data.toString();

    // Split collected data by line endings
    var parts = readBuffer.split(/(\r\n|\r|\n)+/);
    
    // If there is leftover data, 
    readBuffer = parts.pop();

    parts.forEach(function (part) {
      if (part.match(/^\s*$/))
        return;

      self.parseGcode(part, readFileState);
    });
  });
};

TinyG.prototype.list = function(callback) {
  SerialPortModule.list(function (err, results) {
    if (err) {
      callback(err, null);
      return;
    }
    
    var tinygOnlyResults = [];
    
    for (var i = 0; i < results.length; i++) {
      var item = results[i];
      if (item.manufacturer == 'FTDI' || item.manufacturer == 'Synthetos') {
        tinygOnlyResults.push(item);
      }
    }
    
    callback(null, tinygOnlyResults);
  })
};


TinyG.prototype.useSocket = function(socket) {
  var self = this;
  
  self.on('open', function() { socket.emit('open'); });
  self.on('error', function(err) { socket.emit('error', err); });
  self.on('close', function(err) { socket.emit('close', err); });
  self.on('data', function(data) { socket.emit('data', data); });
  
  self.on('configChanged', function(changed) { socket.emit('configChanged', changed); });
  self.on('statusChanged', function(changed) { socket.emit('statusChanged', changed); });
  self.on('gcodeReceived', function(gc) { socket.emit('gcodeReceived', gc); });
  self.on('unitChanged', function(unitMultiplier) { socket.emit('unitChanged', unitMultiplier); });
  
  // Function proxies:
  socket.on('open', function() { self.open.apply(self, arguments); });
  socket.on('close', function() { self.close(); });
  socket.on('write', function(data) { self.write(data); });
  socket.on('sendFile', function(path) { self.sendFile(path); });
  socket.on('readFile', function(path) { self.readFile(path); });
  socket.on('list', function() {
    self.list(function(err, results) {
      if (err) {
        socket.emit('error', err);
        return;
      }
      // console.log("listing:" + results);
      socket.emit('list', results);
    }); 
  });
  socket.on('getStatus', function(callback) { callback(self._status); });
  socket.on('getConfiguration', function(callback) { callback(self._configuration); });
  
};

module.exports = TinyG;

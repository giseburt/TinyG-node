var EventEmitter = require('events').EventEmitter;
var util = require('util');

var spawn = require('child_process').spawn;

var SerialPort = require("serialport").SerialPort;

function TinyG(path) {
  // Squirrel away a ref to 'this' for use in callbacks.
  var self = this;
  
  // Store the last sr
  this._state = {};
  
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
  Object.defineProperty(this._state, "unit", {
    // We define the get/set keys, so this is an "accessor descriptor".
    get: function() { return self.lengthMultiplier == 25.4 ? 0 : 1; },
    set: function(newUnit) {
      var oldLM = self.lengthMultiplier;
      self.lengthMultiplier = (newUnit == 0 ? 25.4 : 1);

      if (self.lengthMultiplier != oldLM)
        self.emit("unitChanged", self.lengthMultiplier);
    },
    configurable : true, // We *can* delete this property. I don't know why though.
    enumerable : true // We want this one to show up in enumeration lists.
  });

  // self.state.unitMultiplier returns with the multiplier from mm, which is 1 for mm mode and 25.4 for inches mode.
  Object.defineProperty(this._state, "unitMultiplier", {
    // We define the get/set keys, so this is an "accessor descriptor".
    get: function() { return self.lengthMultiplier; },
    set: function(newUnitMultiplier) {
      if (newUnitMultiplier == 1 || newUnitMultiplier == 25.4) {
        var oldLM = self.lengthMultiplier;
        self.lengthMultiplier = newUnitMultiplier;

        if (self.lengthMultiplier != oldLM)
          self.emit("unitChanged", self.lengthMultiplier);
      }
    },
    configurable : true, // We *can* delete this property. I don't know why though.
    enumerable : true // We want this one to show up in enumeration lists.
  });
  
  // Store all of the config data
  this._configuration = {};
  
  function _setupConfigSchema(subconfig, subschema, breadcrumbs) {
    var aliasMap = null;
    for (n in subschema) {
      if (n == "_aliasMap") {
        aliasMap = subschema["_aliasMap"];
        continue;
      }
      
      var v = subschema[n];
      
      if (breadcrumbs == undefined) {
        breadcrumbs = [];
      }
      
      // Look for "objects," but arrays are objects, so we exclude ones with a '0' member.
      // This means a
      if (typeof subschema[n] == 'object' && !Array.isArray(subschema[n])) {
        subconfig[n] = {};
        // recurse
        breadcrumbs.push(n);
        _setupConfigSchema(subconfig[n], subschema[n], breadcrumbs);
        breadcrumbs.pop();
      } else {
        // Normalize v to always be an array...
        if (!Array.isArray(v))
          v = [v];
        
        // Is this a normal value
        if (v[0] == "number" || v[0] == "string") {
          // Create the property, and init it as null.
          subconfig[n] = null;
        } else

        // Is this a length?
        if (v[0] == "length") {
          // We need to force a new context, and for..in doesn't do that.
          // So we make a new function, and then call it immediately.
          (function(subconfig, n, newN) {
            
            // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty
            //  for a better explanation of what's happening here.

            // We squirrel away the actual value in _n
            Object.defineProperty(subconfig, newN, {
              value: null, // We give this a value, so it's a "data descriptor".
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
              get: function() { return subconfig[newN] / self.lengthMultiplier; },
              set: function(newLength) { subconfig[newN] = newLength * self.lengthMultiplier; },
              configurable : true, // We *can* delete this property. I don't know why though.
              enumerable : true // We want this one to show up in enumeration lists.
            });

          })(subconfig, n, "_"+n);
        }

      } // (is object) else
      
    } // for (n in subschema)
    
    if (aliasMap != null && aliasMap.match(/^[\*\%]$/)) {
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
      
      aliasesToBaseString = breadcrumbs.join('/');
      
      for (n in subschema) {
        if (n.match(/^_/))
          continue;
        
        // We need to force a new context, and for..in doesn't do that.
        // So we make a new function, and then call it immediately.
        (function(conf, subconfig, valueKey, aliasKey, aliasesToString) {

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
          
        })(self._configuration, subconfig, n, prefixKey+n, [aliasesToBaseString, n].join('/'));
        
      }; // for (n in subschema) (for aliasMap)
    } // if (aliasMap...
  };

  try {
    var schema = require('./configSchema.json');
    
    _setupConfigSchema(this._configuration, schema);
  } catch(err) {
    self.emit('error', err);
  }

  var _merge = function (changed, to, from, changedRoot) {
    if (changedRoot == undefined) {
      changedRoot = changed;
    }

    for (var n in from) {
      if (to[n] == null || typeof to[n] != 'object') {
        // If the value changed, record it in the changed object
        if (to[n] != from[n]) {
          
          if (to[n+"/aliasesTo"] != undefined) {
            var aliasMapFromRoot = to[n+"/aliasesTo"].split("/");
            var c = changedRoot;
            var key = null;
            while (aliasMapFromRoot.length > 1) {
              key = aliasMapFromRoot.shift();
              if (c[key] == undefined) {
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
        if (changed[n] == undefined) {
          changed[n] = {};
        }
        
        to[n] = _merge(changed[n], to[n], from[n], changedRoot);

        // if the new object ended up empty, delete it
        if (changed[n] != undefined && Object.keys(changed[n]).length == 0) {
          delete changed[n];
        }
      } // if (is not object) ... else
    } // for (n in from)

    return to;
  };

  this._mergeIntoState = function(jsonObj) {
    var changed = {};
    _merge(changed, this._state, jsonObj);
    return changed;
  };

  this._mergeIntoConfiguration = function(jsonObj) {
    var changed = {};
    _merge(changed, this._configuration, jsonObj);
    return changed;
  };
  
  // Via http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
  // Thank you 
  this.hashCode = function(s) {
    var hash = 0,
    strlen = s.length,
    i,
    c;
    if ( strlen === 0 ) {
      return hash;
    }
    for ( i = 0; i < strlen; i++ ) {
      c = s.charCodeAt( i );
      // hash = (31 * hash) + c;
      hash = ((hash << 5) - hash) + c;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  };
  
  _tinygParser = function (emitter, buffer) {
    // Collect data
    readBuffer += buffer.toString();
    
    // Split collected data by line endings
    var parts = readBuffer.split(/(\r\n|\r|\n)+/);
    
    // If there is leftover data, 
    readBuffer = parts.pop();
    
    parts.forEach(function (part, i, array) {
      // Cleanup and remove blank or all-whitespace lines.
      if (part.match(/^\s*$/))
        return;
      
      // console.log('part: ' + part.replace(/([\x00-\x20])/, "*$1*"));
      emitter.emit('data', part);
      
      if (part[0] == "\{" /* make the IDE happy: } */) {
        jsObject = JSON.parse(part);
        
        // We have to look in r/f for the footer due to a bug in TinyG...
        var footer = jsObject['f'] || jsObject['r']['f'];
        if (footer != null) {
          /*
           * Checksums are failing too often, then there's no sign of transmission errors...
           * Bail on checksum checks for now...
           
          // To calculate the hash, we need to partially hand parse the part. We'll use a RegExp:
          hashablePart = part.replace(/(,"f":\[[0-9.]+,[0-9.]+,[0-9.]+),[0-9.]+\]\}\}?/, "$1");
          
          console.log("hashablePart: '%s'", hashablePart);
          
          // See http://javascript.about.com/od/problemsolving/a/modulobug.htm for the weirness explained.
          // Short form: javascript has a modulus bug.
          checksum = (((self.hashCode(hashablePart) + 0) % 9999) + 9999) % 9999;
          
          if (checksum != footer[3])
            console.error("ERROR: Checksum mismatch: (actual) %d != (reported) %d)", checksum, footer[3]);
          */
          
          if (footer[1] != 0) {
            colsole.error("ERROR: TinyG reported a parser error: $d (based on %d bytes read and a checksum of %d)", footer[1], footer[2], footer[3]);
          }
          
          // Remove the object so it doesn't get parsed anymore
          delete jsObject['f'];
          delete jsObject['r']['f'];
        }
        
        // console.log(util.inspect(jsObject));
        if (jsObject['r'].hasOwnProperty('sr')) {
          var changed = self._mergeIntoState(jsObject['r']);
          if (Object.keys(changed).length > 0) {
            self.emit("stateChanged", changed);
          }
        }
        else {
          var changed = self._mergeIntoConfiguration(jsObject['r']);
          if (Object.keys(changed).length > 0) {
            self.emit("configChanged", changed);
          }
        }

        // console.log("Conf: " + JSON.stringify(self._configuration));
        // console.log("Stat: " + util.inspect(self._state));
      }
    } // parts.forEach function
    ); // parts.forEach
  } // _tinygParser;
  
  var jsObject;
  var readBuffer = "";  
  serialPort = new SerialPort(path,
    {
    baudrate: 115200,
    flowcontrol: true,
    // Provide our own custom parser:
    parser: _tinygParser
    }
  );

  serialPort.on("open", function () {
    // spawn('/bin/stty', ['-f', path, 'crtscts']);
    serialPort.on('data', function(data) {
      self.emit("data", data);
    });  
    serialPort.write('{"ee" : 0}\n');//Set echo off, it'll confuse the parser
    serialPort.write('{"jv" : 4}\n');//Set JSON verbosity to 4
    
    serialPort.write('{"1"  :""}\n');//return motor 1 settings
    serialPort.write('{"2"  :""}\n');//
    serialPort.write('{"3"  :""}\n');//
    serialPort.write('{"4"  :""}\n');//
    serialPort.write('{"x"  :""}\n');//return X axis settings
    serialPort.write('{"y"  :""}\n');//
    serialPort.write('{"z"  :""}\n');//
    serialPort.write('{"a"  :""}\n');//
    serialPort.write('{"b"  :""}\n');//
    serialPort.write('{"c"  :""}\n');//
    serialPort.write('{"sys":""}\n');//return system settings
    serialPort.write('{"pos":""}\n');//return work coordinate positions fox XYZABC axes. In mm or inches depending on G20/G21
    serialPort.write('{"mpo":""}\n');//return absolute machine positions fox XYZABC axes. Always in mm, regardless of G20/G21
    serialPort.write('{"ofs":""}\n');//return current offsets fox XYZABC axes. Sums coordinate system and G92 offsets. in mm.
    serialPort.write('{"hom":""}\n');//return homing state fox XYZABC axes, and 'e' for the entire machine. 1=homed, 0=not.
    serialPort.write('{"p1":""} \n');//return PWM channel 1 settings (currently there is only 1 PWM channel)
    serialPort.write('{"g54":""}\n');//return offsets for work coordinate system #1 (G54)
    serialPort.write('{"g55":""}\n');//#2
    serialPort.write('{"g56":""}\n');//#3
    serialPort.write('{"g57":""}\n');//#4
    serialPort.write('{"g58":""}\n');//#5
    serialPort.write('{"g59":""}\n');//#6
    serialPort.write('{"g92":""}\n');//return G92 offsets currently in effect
    serialPort.write('{"g28":""}\n');//return coordinate saved by G28 command
    serialPort.write('{"g30":""}\n');//return coordinate saved by G30 command

    // Test merging
    serialPort.write('{"x":{"am":""}}\n');
    serialPort.write('{"xam":""}\n');
    serialPort.write('{"sr":""}\n');
    serialPort.write('{"g54":{"x":100}}\n');
  });

  // Do stuff here.
};

util.inherits(TinyG, EventEmitter);

module.exports.TinyG = TinyG;

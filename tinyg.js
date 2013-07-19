var EventEmitter = require('events').EventEmitter;
var util = require('util');

var spawn = require('child_process').spawn;

var SerialPort = require("serialport").SerialPort;

function TinyG(path) {
  // Squirrel away a ref to 'this' for use in callbacks.
  var self = this;
  
  // Store the last sr
  this.state = {};
  
  // Store all of the config data
  this.configuration = {};
  
  this.lengthMultiplier = 1; // this should be either 1 (mm) or 25.4 (inches)

  var _setupSchema = function (subconfig, subschema, breadcrumbs) {
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
        _setupSchema(subconfig[n], subschema[n], breadcrumbs);
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
          // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty
          //  for a better explanation of what's happening here.
          
          // We squirrel away the actual value in _n
          Object.defineProperty(subconfig, "_"+n, {
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
            get: function() { return subconfig["_"+n] / self.lengthMultiplier; },
            set: function(newLength) { subconfig["_"+n] = newLength * self.lengthMultiplier; },
            configurable : true, // We *can* delete this property. I don't know why though.
            enumerable : true // We want this one to show up in enumeration lists.
          });
        }

      } // (is object) else
      
    } // for (n in subschema)
    
    if (aliasMap == "*") {
      // We only support "*" type aliasMaps right now...

      /*
      * if breadcrumbs = ['x']
      * and subschema has a key 'vm'
      * them we make configuration['xvm'] a getter and setter for configuration['x']['vm']
      */

      var prefixKey = breadcrumbs.join('');
      for (n in subschema) {
        if (n.match(/^_/))
          continue;

        console.log("Creating alias %s", prefixKey+n);
        
        // var key = n;
        var value = subconfig[n];
        Object.defineProperty(self.configuration, prefixKey+n, {
          // We define the get/set keys, so this is an "accessor descriptor".
          get: function() { return value; },
          set: function(newValue) { value = newValue; },
          configurable : true, // We *can* delete this property. I don't know why though.
          enumerable : false // We *don't* want this alias to show up in enumeration lists.
        });
      }; // for (n in subschema) (for aliasMap)
    } // if (aliasMap...
  };

  try {
    var schema = require('./schema.json');
    
    _setupSchema(this.configuration, schema);
  } catch(err) {
    self.emit('error', err);
  }

  var _merge = function (to, from) {
    for (n in from) {
      if (to[n] == null || typeof to[n] != 'object') {
        to[n] = from[n];
      } else if (typeof from[n] == 'object') {
        to[n] = _merge(to[n], from[n]);
      }
    }

    return to;
  };

  this._mergeIntoState = function(jsonObj) {
    _merge(this.state, jsonObj);
  };

  this._mergeIntoConfiguration = function(jsonObj) {
    _merge(this.configuration, jsonObj);
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
    var parts = readBuffer.split(/(\r\n?|\n)+/);
    
    // If there is leftover data, 
    readBuffer = parts.pop();
    
    parts.forEach(function (part, i, array) {
      console.log('part: ' + part.replace(/([\x00-\x20])/, "*$1*"));
      
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
        
        console.log(util.inspect(jsObject));
        if (jsObject['r'].hasOwnProperty('sr'))
          self._mergeIntoState(jsObject['r']);
        else
          self._mergeIntoConfiguration(jsObject['r']);

        console.log("Conf: " + JSON.stringify(self.configuration));
        // console.log("Stat: " + util.inspect(self.state));
      } else if (!part.match(/^\s+$/)) {
        emitter.emit('data', part);
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
      console.log('data received: ' + data);
    });  
    serialPort.write('{"ee" : 0}\n');//Set echo off, it'll confuse the parser
    serialPort.write('{"jv" : 4}\n');//Set JSON verbosity to 4

    serialPort.write('{"1"  :""}\n');//return motor 1 settings
    serialPort.write('{"2"  :""}\n');//
    serialPort.write('{"3"  :""}\n');//
    serialPort.write('{"4"  :""}\n');//
    // serialPort.write('{"x"  :""}\n');//return X axis settings
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
    // serialPort.write('{"x":{"am":""}}\n');
    serialPort.write('{"xam":""}\n');
    serialPort.write('{"qr":""}\n');
    serialPort.write('{"sr":""}\n');
    serialPort.write('{"qr":""}\n');
    serialPort.write('{"sr":""}\n');
    // serialPort.write('{"g54":{"x":"0"}}\n');
  });

  // Do stuff here.
};

util.inherits(TinyG, EventEmitter);

module.exports.TinyG = TinyG;

var EventEmitter = require('events').EventEmitter;
var util = require('util');

var spawn = require('child_process').spawn;

var SerialPort = require("serialport").SerialPort;

function TinyG(path) {
  var self = this;
  var state = {};
  this.state = state;

  function Axis() {
    this.am = null;
    this.vm = null;
    this.fr = null;
    this.tm = null;
    this.jm = null;
    this.jh = null;
    this.jd = null;
    this.sn = null;
    this.sx = null;
    this.sv = null;
    this.lv = null;
    this.lb = null;
    this.zb = null;
  };

  var configuration = {
    sys: {},
    get jv() { return this.sys.jv; },
    set jv(x) { this.sys.jv = x;},

    x: new Axis(0),
    get xam() { return this.x.am; },
    set xam(x) { this.x.am = x; },

    y: new Axis(),
    z: new Axis(),
  };
  this.configuration = configuration;

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
  
  var jsObject;
  var readBuffer = "";  
  serialPort = new SerialPort(path, {
    baudrate: 115200,
    flowcontrol: true,
    // Provide our own custom parser:
    parser: function (emitter, buffer) {
      // Collect data
      readBuffer += buffer.toString();
      
      // Split collected data by line endings
      var parts = readBuffer.split(/(\r\n?|\n)+/);
      
      // If there is leftover data, 
      readBuffer = parts.pop();
      
      parts.forEach(function (part, i, array) {
        // console.log('part: ' + part.replace(/([\x00-\x20])/, "*$1*"));
        
        if (part[0] == "{") {
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
            
            if (footer[1] != 0)
              colsole.error("ERROR: TinyG reported a parser error: $d (based on %d bytes read and a checksum of %d)", footer[1], footer[2], footer[3]);

            // Remove the object so it doesn't get parsed anymore
            delete jsObject['f'];
            delete jsObject['r']['f'];
          }
          
          console.log(util.inspect(jsObject));
          if (jsObject['r'].hasOwnProperty('sr'))
            self._mergeIntoState(jsObject['r']);
          else
            self._mergeIntoConfiguration(jsObject['r']);

          console.log("Conf: " + util.inspect(self.configuration));
          console.log("Stat: " + util.inspect(self.state));
        } else if (!part.match(/^\s+$/)) {
          emitter.emit('data', part);
        }
      });
    }
  });

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
    serialPort.write('{"x":{"am":""}}\n');
    serialPort.write('{"xam":""}\n');
    serialPort.write('{"qr":""}\n');
    serialPort.write('{"sr":""}\n');
    serialPort.write('{"qr":""}\n');
    serialPort.write('{"sr":""}\n');
    // serialPort.write('{"g54":{"x":"0"}}\n');
  });

  // Do stuff here.
}

util.inherits(TinyG, EventEmitter);

module.exports.TinyG = TinyG;

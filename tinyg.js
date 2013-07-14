var EventEmitter = require('events').EventEmitter;
var util = require('util');

var SerialPort = require("serialport").SerialPort;

function TinyG(path) {
  state = {};
  
  var readBuffer = "";  
  serialPort = new SerialPort(path, {
    baudrate: 115200,
    // Provide our own custom parser:
    parser: function (emitter, buffer) {
      // Collect data
      readBuffer += buffer.toString();
      // Split collected data by delimiter
      var parts = readBuffer.split(/(\r\n?|\n)+/)
      readBuffer = parts.pop();
      parts.forEach(function (part, i, array) {
        if (part[0] == "{") {
          var jsObject = JSON.parse(part);
          console.log('JSON: ' + JSON.stringify(jsObject['r']));
        } else if (!part.match(/^\s+$/)) {
          emitter.emit('data', part);
        }
      });
    }
  });

  serialPort.on("open", function () {
    serialPort.on('data', function(data) {
      console.log('data received: ' + data);
    });  
    serialPort.write('{"jv" :4 }\n');//Set JSON verbosity to 4
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
  });

  var self = this;
  
  // Do stuff here.
}

util.inherits(TinyG, EventEmitter);

module.exports.TinyG = TinyG;

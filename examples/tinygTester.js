#!/usr/bin/env node

// This is (going to be) the node script we use to test TinyG boards in production.

var TinyG = require("../");
var optimist = require('serialport/node_modules/optimist');
var util = require('util');

var args = optimist
  .alias('h', 'help')
  .alias('h', '?')
  .options('portname', {
    alias: 'p',
    describe: 'Name of serial port. Use -l to see the available ports.'
  })
  .options('list', {
    alias: 'l',
    describe: 'List names of probably TinyG serial ports.'
  })
  // .options('baud', {
  //   describe: 'Baud rate.',
  //   default: 9600
  // })
  // .options('databits', {
  //   describe: 'Data bits.',
  //   default: 8
  // })
  // .options('parity', {
  //   describe: 'Parity.',
  //   default: 'none'
  // })
  // .options('stopbits', {
  //   describe: 'Stop bits.',
  //   default: 1
  // })
  // .options('localecho', {
  //   describe: 'Enable local echo.',
  //   boolean: true
  // })
  .argv;


if (args.help) {
  optimist.showHelp();
  return process.exit(-1);
}

var g = new TinyG();

if (args.list) {
  console.log("Available TinyG serial ports:");
  
  g.list(function (err, results) {
    if (err) {
      throw err;
    }
    
    for (var i = 0; i < results.length; i++) {
      var item = results[i];
      console.log('%s -- %s "%s"', item.comName, item.pnpId, item.manufacturer);
    }
  });
}
else if (!args.portname) {
  console.error("Serial port name is required.");
  
  // Have it list TinyGs here...
  
  return process.exit(-1);

}
else {

  var opened = false;

  g.open(args.portname);

  g.on('open', function(data) {
    console.log('#### open');

    g.on('data', function(data) {
      // console.log('#### data received: ' + data);
    });

    g.on('close', function() {
      console.log("Closed!!");
      process.exit(0);
    });

    g.on('stateChanged', function(changed) {
      console.log("State changed: " + util.inspect(changed));
      
      if (opened && changed.stat == 4) {
        console.log("Closing");
        g.close();
      }
      opened = true;
    });

    g.on('configChanged', function(changed) {
      console.log("Config changed: " + util.inspect(changed));
    });

    g.write("g0x10\n");
    g.write("g0x0\n");
    g.write("m2\n");
    // console.log('#### open');
    // console.log('sys/ex: ' + util.inspect(tinyg.ex));

    // setTimeout(function() { console.log('timeout all config: ' + JSON.stringify(tinyg.configuration)); }, 2000);
  });
}


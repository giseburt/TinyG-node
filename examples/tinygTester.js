#!/usr/bin/env node

// This is (going to be) the node script we use to test TinyG boards in production.

var TinyG = require("../").TinyG;
var optimist = require('serialport/node_modules/optimist');
var util = require('util');

var args = optimist
  .alias('h', 'help')
  .alias('h', '?')
  .options('portname', {
    alias: 'p',
    describe: 'Name of serial port. See serialPortList.js for open serial ports.'
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

if (!args.portname) {
  console.error("Serial port name is required.");
  
  // Have it list TinyGs here...
  
  return process.exit(-1);
}

var tinyg = new TinyG(args.portname, false);

tinyg.open(function() {
  tinyg.on('data', function(data) {
    console.log('#### data received: ' + data);
  });

  tinyg.on('stateChanged', function(changed) {
    console.log("State changed: " + util.inspect(changed));
  });

  tinyg.on('configChanged', function(changed) {
    console.log("Config changed: " + util.inspect(changed));
  });
});

tinyg.on('open', function(data) {
  // console.log('#### open');
  // console.log('sys/ex: ' + util.inspect(tinyg.ex));
  
  setTimeout(function() { console.log('timeout all config: ' + JSON.stringify(tinyg.configuration)); }, 2000);
});

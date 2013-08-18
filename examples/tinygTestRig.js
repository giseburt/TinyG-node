#!/usr/bin/env node

// Copy this script to /var/lib/cloud9/autorun/ on a beaglebone
// To have an automatic-on-connect test routine run.
// Warning : Some of this will only make sense with the test-rig hardware in place.
var fs = require('fs');
var b = require('bonescript');
var TinyG;

try {
  TinyG = require("tinyg");
}
catch (e) {
  TinyG = require("./TinyG-node");
}

var util = require('util');

var ledPin0 = "USR0";
var ledPin1 = "USR1";
var ledPin2 = "USR2";
var ledPin3 = "USR3";

function init() {
  b.pinMode(ledPin0, b.OUTPUT);
  b.pinMode(ledPin1, b.OUTPUT);
  b.pinMode(ledPin2, b.OUTPUT);
  b.pinMode(ledPin3, b.OUTPUT);

  devSerialChanged("init", "serial");
}

function devSerialChanged(event, filename) {
  // DEBUGGING:
  console.log('event is: ' + event);
  if (filename) {
    console.log('filename provided: ' + filename);
  }
  else {
    console.log('filename not provided');
  }

  if (filename && filename == "serial") {
    if (fs.existsSync("/dev/serial/by-id/")) {
      tinygAttached();
      return;
    }
    tinygDetached();
  }
}

init();

var watcher = fs.watch('/dev/');
watcher.on('change', devSerialChanged);

function tinygDetached() {
  console.log('-');

  var state = b.LOW;

  b.digitalWrite(ledPin0, state);
  b.digitalWrite(ledPin1, state);
  b.digitalWrite(ledPin2, state);
  b.digitalWrite(ledPin3, state);
}

function tinygAttached() {
  console.log('+');

  var state = b.HIGH;

  b.digitalWrite(ledPin0, state);
  b.digitalWrite(ledPin1, state);
  b.digitalWrite(ledPin2, state);
  b.digitalWrite(ledPin3, state);

  var tinyg = new TinyG();
  tinyg.open('/dev/ttyUSB0', false);
  var closeTimeout = null;
  b.digitalWrite(ledPin3, b.LOW);

  function resetClose() {
    clearTimeout(closeTimeout);
    closeTimeout = setTimeout(function() {
      console.log('#### close');
      b.digitalWrite(ledPin1, b.LOW);
      tinyg.close();
    }, 1000);
  }
  tinyg.on('data', function(data) {
    console.log('#### data received: ' + data);
    resetClose();
  });

  var starting = true;
  tinyg.on('stateChanged', function(changed) {
    console.log("State changed: " + util.inspect(changed));
    if (tinyg.status.stat == 4) {
      if (starting) {
        starting = false;
        return;
      }
      tinyg.write('{"md":1}\n');
      console.log("##DONE");
      clearTimeout(closeTimeout);
      tinyg.close();
      b.digitalWrite(ledPin1, b.LOW);
    }
    else {
      console.log("stat: ", tinyg.status.stat);
    }
  });

  tinyg.on('configChanged', function(changed) {
    console.log("Config changed: " + util.inspect(changed));
  });

  tinyg.on('open', function() {
    b.digitalWrite(ledPin2, b.LOW);

    resetClose();
    tinyg.write('{"test":1}\n');

    // tinyg.write('{"gc":"g0x10"}\n');
    // tinyg.write('{"gc":"g0x0"}\n');
    // tinyg.write('{"gc":"m2"}\n');
    // console.log('#### open');
    // console.log('sys/ex: ' + util.inspect(tinyg.ex));
  });

}
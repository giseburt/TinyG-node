#!/usr/bin/env node

// This is (going to be) the node script we use to test TinyG boards in production.

var TinyG = require("../");
var util = require('util');
var readline = require('readline');

var args = require('nomnom')
  .script("q")
  .options({
    gcode: {
      position: 0,
      help: "Gcode file to run"
    },
    port: {
      abbr: 'p',
      metavar: 'PORT',
      help: "Name of serial port. Use -l to see the available ports."
    },
    dataport: {
      abbr: 'd',
      metavar: 'PORT',
      help: "Name of data serial port. Use -l to see the available ports."
      },
    list: {
      abbr: 'l',
      flag: true,
      help: "Name of data serial port. Use -l to see the available ports."
    }
  }).parse();

// To debug the args:
// console.error(args);

if (args.help) {
  optimist.showHelp();
  return process.exit(-1);
}

var g = new TinyG();

if (args.list) {
  g.list(function (err, results) {
    if (err) {
      throw err;
    }

    var gs = [];

    for (var i = 0; i < results.length; i++) {
      var item = results[i];
      // console.log('%s -- %s "%s"', item.comName, item.pnpId, item.manufacturer);
      console.log(util.inspect(item));
    }

    if (results.length == 0) {
      console.error("No TinyGs found. (Do you maybe need to install FTDI drivers?).");
      process.exit(0);
    }
  });

}
else {

  if (!args.port) {
    g.list(function (err, results) {
      if (err) {
        throw err;
      }

      if (results.length == 1) {
        if (results[0].dataPortPath) {
          console.warn("Found command port: '%s' with data port '%s'.", results[0].path, results[0].dataPortPath);
          args.port = results[0].path;
          args.dataport = results[0].dataPortPath;
        } else {
          console.warn("Found port: '%s'.", results[0].path);
          args.port = results[0].path;
        }

        openTinyG();
      } else if (results.length > 1) {
        console.error("Autodetect found multiple TinyGs:");

        for (var i = 0; i < results.length; i++) {
          var item = results[i];
          if (item.dataPortPath) {
            console.error("Found command port: '%s' with data port '%s'.", item.path, item.dataPortPath);
          } else {
            console.error("Found port: '%s'.", item.path);
          }
        }
        process.exit(0);
      } else {
        console.error("No TinyGs found. (Do you maybe need to install FTDI drivers?).");
        process.exit(0);
      }

    });
  } else {
    openTinyG();
  }
}


function openTinyG() {
  var opened = false;

  g.open(args.port, {dataPortPath : args.dataport});

  g.on('open', function(data) {
    // console.log('#### open');

    var rl = readline.createInterface(process.stdin, process.stdout);
    rl.setPrompt('TinyG# ');
    rl.prompt();

    rl.on('line', function(line) {
      console.log(">"+line);
      g.write(line);
      rl.prompt();
    }).on('close', function() {
      g.close();
    });

    g.on('data', function(data) {
      // rl.pause();
      console.log('<' + data);
      // rl.resume();
      // rl.prompt();
    });

    g.on('close', function() {
      console.log("### Port Closed!!");
      process.exit(0);
    });

    if (args.gcode) {
      g.sendFile(args.gcode);
    }

    // g.on('stateChanged', function(changed) {
    //   console.log("State changed: " + util.inspect(changed));
    //
    //   if (opened && changed.stat == 4) {
    //     console.log("Closing");
    //     g.close();
    //   }
    //   opened = true;
    // });
  });
}

#!/usr/bin/env node

// This is (going to be) the node script we use to test TinyG boards in production.

var TinyG = require("../");
var util = require('util');
var fs = require('fs');
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
    log: {
      abbr: 'g',
      metavar: 'LOGFILE',
      default: "/dev/null",
      help: "Name of file to log to. Piping STDERR to a file will do the same thing (and trump this option)."
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
var logStream = process.stderr; // We may change this later
var startTime = new Date();

if (args.log) {
  logStream = fs.createWriteStream(args.log, 'r+');
  logStream.write('## Opened log: ' + startTime.toLocaleString() + "\n");
}

g.on('error', function (err) {
  logStream.write(err+'\n');
});

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
      console.log("No TinyGs found. (Do you maybe need to install FTDI drivers?).");
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
        console.log("Error: Autodetect found multiple TinyGs:");

        for (var i = 0; i < results.length; i++) {
          var item = results[i];
          if (item.dataPortPath) {
            console.log("Found command port: '%s' with data port '%s'.", item.path, item.dataPortPath);
          } else {
            console.log("Found port: '%s'.", item.path);
          }
        }
        process.exit(0);
      } else {
        console.log("No TinyGs found. (Do you maybe need to install FTDI drivers?).");
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

    if (process.stdout.isTTY) {
      var rl = readline.createInterface(process.stdin, process.stdout);
      rl.setPrompt('TinyG# ');
      rl.prompt();

      rl.on('line', function(line) {
        logStream.write(util.format(">%s", line));
        g.write(line);
        rl.prompt(true);
      }).on('close', function() {
        g.close();
      });

      var leftText = "Progress |";
      var rightText = "|   0% ";

      var maxLineNumber = 1;

      // If we call sendfile, this will update us ont he send progress:
      g.on('sendBufferChanged', function(b) {
        maxLineNumber = b.lines;
      });

      g.on('statusChanged', function(st) {
        if (st.line) {
          if (st.line > maxLineNumber) {
            maxLineNumber = st.line;
          }
          // clear the whole line.
          // readline.moveCursor(process.stdout, 0, -1);
          // readline.clearLine(process.stdout, 0);
          process.stdout.write("\r");

          var maxWidth = process.stdout.columns;
          var paddingWidth = leftText.length + rightText.length;
          var barWidth = (maxWidth - paddingWidth) * (st.line/maxLineNumber);
          var barLeft = (maxWidth - paddingWidth);

          process.stdout.write(leftText);
          // console.error("maxWidth: %d, paddingWidth: %d, sent: %d, lines: %d", maxWidth, paddingWidth, b.sent, b.lines);
          while (barWidth > 1.0) {
            process.stdout.write('=');
            barWidth = barWidth - 1.0;
            barLeft--;
          }
          if (barWidth > 0.6) {
            process.stdout.write('+');
            barLeft--;
          } else if (barWidth > 0.3) {
            process.stdout.write('-');
            barLeft--;
          }
          while (barLeft-- > 0) {
            process.stdout.write('_');
          }

          process.stdout.write("| ")
          var percent = ((st.line/maxLineNumber) * 100).toFixed(0);
          if (percent < 100) {
            process.stdout.write(" ")
          }
          if (percent < 10) {
            process.stdout.write(" ")
          }
          process.stdout.write(percent)
          process.stdout.write("%")

          // if (process.stderr.isTTY) {
          //   process.stdout.write("\n")
          // } else {
            process.stdout.write("\r")
          // }
        }
        // rl.prompt(true);
      });
    }

    g.on('data', function(data) {
      logStream.write(util.format('<%s\n', data));
    });

    g.on('sentGcode', function(data) {
      logStream.write(util.format('>%s\n', data.gcode));
    });

    g.on('close', function() {
      logStream.write(util.format("### Port Closed!!\n"));

      if (args.log) {
        // TODO: Use startTime to determine length of job run
        logStream.write('## Closing log: ' + (new Date()).toLocaleString() + "\n\n");
        // logStream.close();
      }

      // process.exit(0);
    });

    if (args.gcode || !process.stdin.isTTY) {
      g.sendFile(args.gcode || process.stdin, function(err) {
        if (err) {
          logStream.write(util.format("Error returned: %s\n", err));
        }
        logStream.write(util.format("### Done sending\n"));
        process.stdout.write("\n")
        rl.close();
        g.close();
      });
    }

    // g.on('stateChanged', function(st) {
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

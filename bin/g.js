#!/usr/bin/env node

// This is (going to be) the node script we use to test TinyG boards in production.

var TinyG = require("../");
var util = require('util');
var fs = require('fs');
var readline = require('readline');
var chalk = require('chalk');
var sprintf = require('sprintf').sprintf;

var STAT_CODES = {
  0: "Init",
  1: "Ready",
  2: "ALARM",
  3: "Stop",
  4: "Ended",
  5: "Running",
  6: "Hold",
  7: "Probing",
  8: "Running Cycle",
  9: "Homing"
};

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

// Interactive means that we're not just showing a progress bar but are presenting a full console.
var interactive = process.stdout.isTTY && process.stdin.isTTY;

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
      noTinygFound();
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
        noTinygFound();
        process.exit(0);
      }

    });
  } else {
    openTinyG();
  }
}

function noTinygFound() {
  console.log("No TinyGs were found. (Is it connected and drivers are installed?)");
}

function openTinyG() {
  var opened = false;

  g.open(args.port, {dataPortPath : args.dataport});

  g.on('open', function() {
    // console.log('#### open');

    if (process.stdout.isTTY) {
      var rl = readline.createInterface(process.stdin, process.stdout);
      rl.setPrompt(chalk.dim('TinyG# '), 'TinyG# '.length);
      rl.prompt();

      rl.on('line', function(line) {
        logStream.write(util.format(">%s", line));
        g.write(line);
        if (interactive) {
          process.stdout.write(chalk.dim(">"+ line)+"\n");
        }
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

      var status = {};

      g.on('statusChanged', function(st) {
        for(var prop in st) {
          status[prop] = st[prop];
        }

        if (interactive) {
          readline.moveCursor(process.stdout, 0, -1);
          readline.clearLine(process.stdout, 0);

          process.stdout.write(
            sprintf("\rPos: X=%4.2f Y=%4.2f Z=%4.2f A=%4.2f Vel:%4.2f (%s)\n",
              status.posx||0,
              status.posy||0,
              status.posz||0,
              status.posa||0,
              status.vel||0,
              STAT_CODES[status.stat] || 'Stopped'
            )
            // util.inspect(status)
          );

          rl.prompt(true);
        }


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
          var percent = ((st.line/maxLineNumber) * 100);
          process.stdout.write(sprintf("%3.0f%%", percent));

          // if (process.stderr.isTTY) {
          //   process.stdout.write("\n")
          // } else {
            process.stdout.write("\r")
          // }
        }
        // rl.prompt(true);
      }); // if st.line

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
      interactive = false;
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

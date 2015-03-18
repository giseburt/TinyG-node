#!/usr/bin/env node

// This is (going to be) the node script we use to test TinyG boards in production.

var TinyG = require("../");
var util = require('util');
var fs = require('fs');
var readline = require('readline');
var chalk = require('chalk');
var sprintf = require('sprintf').sprintf;
var Q = require('Q');
var FS = require('fs');
var readFile = Q.nfbind(FS.readFile);

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
  .script("g")
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
      //default: "/dev/null",
      help: "Name of file to log to. Piping STDERR to a file will do the same thing (and trump this option)."
    },
    list: {
      abbr: 'l',
      flag: true,
      help: "Name of data serial port. Use -l to see the available ports."
    },
    init: {
      abbr: 'i',
      metavar: 'INITFILE',
      help: "Oprional path of a json file containing the initial settings to pass to the TinyG after connection."
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
var sendingFile = false;
var latestMotionStatus = 0;

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
      console.log(util.inspect(item));
    }

    if (results.length == 0) {
      noTinygFound();
      process.exit(0);
    }
  });
} else {
  openTinyG();
}

function noTinygFound() {
  console.log("No TinyGs were found. (Is it connected and drivers are installed?)");
}

function openTinyG() {
  var opened = false;

  if (!args.port) {
    g.openFirst(/*fail if multiple:*/ true);
  } else {
    g.open(args.port, {dataPortPath : args.dataport});
  }

  g.on('open', function() {
    // console.log('#### open');

    var maxLineNumber = 0;

    function completeOpen() {
      if (process.stdout.isTTY) {
        var rl = readline.createInterface(process.stdin, process.stdout);
        rl.setPrompt(chalk.dim('TinyG# '), 'TinyG# '.length);
        rl.prompt();

        // WARNING WARNING WARNING -- using the internals of node readline!!
        //
        // We need to override the default behavior for a few keys.
        // So, we tell stdin to REMOVE all of the listeners to the 'keypress'
        // event, then we will be the only listener. If we don't have a special
        // behavior for the pressed key, then we pass it on to the readline.
        //
        // To avoid using internals too much, we'll snarf in the listeners,
        // store them away, and then call them ourselves.
        var old_keypress_listeners = process.stdin.listeners('keypress');

        process.stdin.removeAllListeners('keypress');
        process.stdin.on('keypress', function (ch, k) {
          if (k && k.ctrl) {
            if (k.name == 'd') {
              // TODO: verify that we are sending a file
              logStream.write(util.format(">>^d\n"));
              g.write('\x04'); // send the ^d
              return;
            }
            else if (k.name == 'c') {
              // TODO: verify that we are sending a file
              // logStream.write(util.format(">>!\n"));
              if (STAT_CODES[latestMotionStatus] == "Hold") {
                // g.write('\x04'); // send the ^d

                var e = util.format("## Recieved CTRL-C in State '%s' -- sending CTRL-D and exiting.\n", STAT_CODES[latestMotionStatus]);
                logStream.write(e);
                if (interactive) {
                  process.stdout.write(chalk.dim(e));
                }

                g.close();
                rl.close();
                return;
              } else if (STAT_CODES[latestMotionStatus].match(/^(Run|Probing$|Homing$)/)) {
                g.write('!');
                return;
              }
            }

          // Single character commands get sent immediately
        } else if (ch && ch.match(/^[!~%]/)) {
            logStream.write(util.format(">>%s\n", ch));
            g.write(ch);
            return;
          }

          for (var i = 0; i < old_keypress_listeners.length; i++) {
            old_keypress_listeners[i](ch,k);
          }
        })

        rl.on('line', function(line) {
          logStream.write(util.format(">%s\n", line));
          g.write(line);
          if (interactive) {
            process.stdout.write(chalk.dim(">"+ line)+"\n");
          }
          rl.prompt(true);
        });

        rl.on('close', function() {
          g.close();
        });

        var leftText = "Progress |";
        var rightText = "|   0% ";

        var status = {};

        g.on('statusChanged', function(st) {
          for(var prop in st) {
            status[prop] = st[prop];
          }

          if (status.stat) {
            latestMotionStatus = status.stat;
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
            );

            process.stdout.write(
              util.inspect(status) + "\n"
            );

            rl.prompt(true);
          }
        }); // g.on('statusChanged', ... )

        g.on('response', function(r) {
          if (r.n) {
            if (r.n > maxLineNumber) {
              maxLineNumber = r.n;
            }
            // clear the whole line.
            // readline.moveCursor(process.stdout, 0, -1);
            // readline.clearLine(process.stdout, 0);
            process.stdout.write("\r");

            var maxWidth = process.stdout.columns;
            var paddingWidth = leftText.length + rightText.length;
            var barWidth = (maxWidth - paddingWidth) * (r.n/maxLineNumber);
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
            var percent = ((r.n/maxLineNumber) * 100);
            process.stdout.write(sprintf("%3.0f%%", percent));

            // if (process.stderr.isTTY) {
            //   process.stdout.write("\n")
            // } else {
              process.stdout.write("\r")
            // }
          } // if st.line
          // rl.prompt(true);
        }); // g.on('statusChanged', ... )
      }

      if (args.gcode || !process.stdin.isTTY) {
        interactive = false;

        function startSendFile() {
          sendingFile = true;
          g.sendFile(args.gcode || process.stdin, function(err) {
            if (err) {
              logStream.write(util.format("Error returned: %s\n", err));
            }
            logStream.write(util.format("### Done sending\n"));
            process.stdout.write("\n")
            rl.close();
            sendingFile = false;
            g.close();
          });
        }

        if (args.gcode) {
          var readStream = fs.createReadStream(args.gcode);
          readStream.once('open', function () {
            maxLineNumber = 0;

            var readBuffer = '';

            readStream.setEncoding('utf8');

            readStream.once('end', function () {
              readStream.close();
            });

            readStream.once('close', function () {
              startSendFile();
            });

            readStream.on('data', function (data) {
              readBuffer += data.toString();

              // Split collected data by line endings
              var lines = readBuffer.split(/(\r\n|\r|\n)+/);

              // If there is leftover data,
              readBuffer = lines.pop();

              lines.forEach(function (line) {
                if (line.match(/^\s*$/))
                  return;

                maxLineNumber++;
              });
            });
          });
        } // args.gcode
        else {
          startSendFile();
        }

      }
    }

    if (args.init) {

      readFile(args.init, "utf-8").then(function (text) {
        return g.set(JSON.parse(text));
      }).then(function () {
        completeOpen();
      });

    } else {
      completeOpen();
    }

    g.on('data', function(data) {
      logStream.write(util.format('<%s\n', data));
    });

    g.on('sentGcode', function(data) {
      logStream.write(util.format('>%s\n', data.gcode));
    });

    g.on('close', function() {
      // clearInterval(srBlaster);
      logStream.write(util.format("### Port Closed!!\n"));

      if (args.log) {
        // TODO: Use startTime to determine length of job run
        logStream.write('## Closing log: ' + (new Date()).toLocaleString() + "\n\n");
        // logStream.close();
      }

      // process.exit(0);
    });
  });
}

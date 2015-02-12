#TinyG-node


A commmand-line utility and library module to abstract communications and control of a TinyG.

#Usage as a command line utility

First install the tinyg npm globally, so it'll be in your path:

```bash
  npm install -g tinyg
```

Now you can just execute the `g` command to get a full "terminal" experience to TinyG. If there is only one TinyG attached, then you don't need to provide any more parameters:

```
  my_host$ g
  Pos: X=0.00 Y=0.00 Z=0.00 A=0.00 Vel:0.00 (Ended)
  TinyG# g0x10
  Pos: X=10.00 Y=0.00 Z=0.00 A=0.00 Vel:0.00 (Stop)
  TinyG# ^C
```

Note: Use `Ctrl-C` to exit.

To send a file with the `g` utility, simply pass the filename of a gcode file, and it'll give you interactive progress bar:

```
  my_host$ g my_awesome_project.gcode
  Found command port: '/dev/cu.usbmodem14521' with data port '/dev/cu.usbmodem14523'.
  TinyG# Opening file 'my_awesome_project.gcode' for streaming.
  Progress |=========================================================______|  91%
```

If you wish to keep a log of the interaction between the TinyG and the `g` utility, then add the `-g LOGFILE` parameter to have it save the log in `LOGFILE`.

_Note: The `g` command line utility is still a little rough around the edges. It's still in active development, so update often!_

##`g(1)` usage

```bash
Usage: q [gcode] [options]

gcode     Gcode file to run

Options:
   -p PORT, --port PORT        Name of serial port. Use -l to see the available ports.
   -d PORT, --dataport PORT    Name of data serial port. Use -l to see the available ports.
   -g LOGFILE, --log LOGFILE   Name of file to log to. Piping STDERR to a file will do the same thing (and trump this option).  [STDERR]
   -l, --list                  Name of data serial port. Use -l to see the available ports.
```

## `g` TODO

* Cleanup formatting output -- the status line often overwrites the prompt, leaving the promt in the wrong place.
* Provide more control over the status line. Possibly go full-screen?
*


#Usage as a library

```javascript
// Create a TinyG library object
var TinyG = require("tinyg");

// Then create a TinyG object called 'g'
var g = new TinyG();
```

Now you have a `g` object, you need to tell it to connect to a TinyG, then you can interact with the TinyG.

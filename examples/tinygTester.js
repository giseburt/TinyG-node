#!/usr/bin/env node

// This is (going to be) the node script we use to test TinyG boards in production.

var TinyG = require("../").TinyG;

var tinyg = new TinyG('/dev/cu.usbserial-AE01DYY5');


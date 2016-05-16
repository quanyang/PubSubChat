var fs = require('fs');
var express = require('express');
var serveStatic = require('serve-static');
var path = require('path');

module.exports.run = function (worker) {
  console.log('   >> Worker PID:', process.pid);
  var app = require('express')();
  var httpServer = worker.httpServer;
  var scServer = worker.scServer;
  app.use(serveStatic(path.resolve(__dirname, 'public')));
  httpServer.on('request', app);
  var count = 0;

  /*
    In here we handle our incoming realtime connections and listen for events.
    */
    scServer.on('connection', function (socket) {  
      console.log(socket.id);
      console.log('User connected');
      socket.on('info', function (data) {
        scServer.global.publish(data.channel, {type: "info", msg:data.msg});
      });
      socket.on('chat', function (data) {
        var time = new Date();
        scServer.global.publish(data.channel, data);
        console.log('Chat:', data,time.getTime());
      });
      socket.on('disconnect', function () {
        console.log('User disconnected');
      });
    });

  };

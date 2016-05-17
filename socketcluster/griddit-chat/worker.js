var fs = require('fs');
var express = require('express');
var serveStatic = require('serve-static');
var path = require('path');

var connectMsg = "Info: %s has joined the chatroom.";
var disconnectMsg = "Info: %s has left the chatroom.";

module.exports.run = function (worker) {
  console.log('   >> Worker PID:', process.pid);
  var app = require('express')();
  var httpServer = worker.httpServer;
  var scServer = worker.scServer;
  app.use(serveStatic(path.resolve(__dirname, 'public')));
  httpServer.on('request', app);

  scServer.on('connection', function (socket) {  
    console.log('User connected');
    //console.log(socket.id);
    var authToken = socket.getAuthToken();
    socket.on('auth', function(data,res) {
      //Validate user
      // Check data.username
      socket.setAuthToken({username: data.username});
    });

    //Blocks publish except for server.
    scServer.addMiddleware(scServer.MIDDLEWARE_PUBLISH_IN, function (req, next) {
      next(true);
    });

    socket.on('connected', function (data) {
      if (authToken){
        scServer.global.publish(data.channel, {type: "info", msg: connectMsg.replace('%s',authToken.username)});
      }
    });

    socket.on('chat', function (data) {
      var time = new Date();
      data.username = authToken.username;
      data.time = time.getTime();
      data.type = "message";
      scServer.global.publish(data.channel, data);
      console.log('Chat:', data);
    });

    socket.on('disconnect', function () {
      console.log('User disconnected');
      //scServer.global.publish(data.channel, {type: "info", msg: disconnectMsg.replace('%s',authToken.username)});
    });
  });

};

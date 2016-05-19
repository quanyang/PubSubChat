var fs = require('fs');
var express = require('express');
var serveStatic = require('serve-static');
var path = require('path');

var connectMsg = "Info: %s has joined the chatroom.";
var disconnectMsg = "Info: %s has left the chatroom.";
var guestUsername = "Guest_%s";
var colors = ["d-re","l-bl","mage","red","pink","blue","teal","oran","d-pu"];

function generateRandomColor() {
    var color = colors[Math.floor(Math.random() * colors.length)];
    return color;
}

function generateGuestId() {
  var randomInt = Math.floor((Math.random() * 10000) + 1000);
  return guestUsername.replace("%s",randomInt);
}

module.exports.run = function (worker) {
  console.log('   >> Worker PID:', process.pid);
  var app = require('express')();
  var httpServer = worker.httpServer;
  var scServer = worker.scServer;
  app.use(serveStatic(path.resolve(__dirname, 'public')));
  httpServer.on('request', app);

  scServer.on('connection', function (socket) {  

    var authToken = null;
    if (socket.authState == "authenticated") {
      authToken = socket.getAuthToken();
    }

    //Blocks publish except for server.
    scServer.addMiddleware(scServer.MIDDLEWARE_PUBLISH_IN, function (req, next) {
      next(true);
    });

    socket.on('auth', function(data,res) {
      //Validate user
      // Check data.username
      socket.setAuthToken({username: generateGuestId(), color: generateRandomColor()});
      console.log("Authing" + socket.getAuthToken().username());
    });

    socket.on('chat', function (data) {
      if (authToken) {
        var time = new Date();
        data.username = authToken.username;
        data.color = authToken.color;
        data.time = time.getTime();
        data.type = "message";
        scServer.global.publish(data.channel, data);
      }
    });

    socket.on('subscribe', function (data) {
      if (authToken){
        scServer.global.publish(data, {type: "info", msg: connectMsg.replace('%s',authToken.username)});
      }
    });

    socket.on('unsubscribe', function (data) {
      if (authToken){
        scServer.global.publish(data, {type: "info", msg: disconnectMsg.replace('%s',authToken.username)});
      }
    });

  });

};

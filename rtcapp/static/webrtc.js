'use strict';

    /* Global variables. */
    var DEBUG = true;

    var clientId = Math.random() * 1000;

    var ws,
        localStream,
        localVideo,
        remoteVideo,
        startBtns,
        stopBtns,
        muteBtns,
        unmuteBtns,
        peerConnection;

    var peerConnectionConfig = {
        'iceServers': [
            {'url': 'stun:stun.services.mozilla.com'}, 
            {'url': 'stun:stun.l.google.com:19302'}
        ]
    };
        
    var constraints = { // Connect local UserMedia
        audio: true,
        video: true,
    };

    /* Shims. */
    navigator.getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia || navigator.webkitGetUserMedia;
    window.RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
    window.RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate || window.webkitRTCIceCandidate;
    window.RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription;

    function log(...args) {
        if (DEBUG) console.log(...args);
    }

    /* Entry point for onload event. */
    function pageReady() {
        log('pageReady()');
        localVideo = document.getElementById('localVideo');
        remoteVideo = document.getElementById('remoteVideo');
        startBtns = document.querySelectorAll('.start-ctrl');
        stopBtns = document.querySelectorAll('.stop-ctrl');
        muteBtns = document.querySelectorAll('mute-ctrl');
        unmuteBtns = document.querySelectorAll('unmute-ctrl');

        assertAPIs();
        initWebSocket();

        startBtns.forEach(function(obj) { obj.addEventListener('click', startAsCaller); });
        stopBtns.forEach(function(obj) { obj.addEventListener('click', stop); });
        muteBtns.forEach(function(obj) { obj.addEventListener('click', startAsCaller); });
        unmuteBtns.forEach(function(obj) { obj.addEventListener('click', startAsCaller); });
    }

    function startAsCaller(event) {
        event.preventDefault();
        event.stopPropagation();
        start(true);
    }

    function start(isCaller) {
        log('--- start('+isCaller+')');

        connectUserMedia().then(function() {
            peerConnection = new RTCPeerConnection(peerConnectionConfig);
            peerConnection.onicecandidate = gotIceCandidate;
            peerConnection.onaddstream = gotRemoteStream;
            peerConnection.onremovestream = removeRemoteStream;
            peerConnection.addStream(localStream);

            if (isCaller) {
                log('I am the CALLER, using peerConnection:', peerConnection);
                peerConnection.createOffer(gotDescription, createOfferError);
            } else {
                log('I am being CALLED, created peerConnection:', peerConnection);
            }
        }).catch(getUserMediaError);
    }

    function stop(event) {
        log('--- stop()');
        if (event) { event.preventDefault(); event.stopPropagation(); }
        if (!!peerConnection) sendMessage('bye');

        peerConnection = null;
        localStream.getVideoTracks()[0].stop();
        localStream.getAudioTracks()[0].stop();
        localStream = null;
        localVideo.src = null;
        remoteVideo.src = null;
    }

    function mute() {
        localStream.getAudioTracks()[0].stop();
    }

    function unmute() {
        localStream.getAudioTracks()[0].start();
    }

    function assertAPIs() {
        if ( ! navigator.getUserMedia)
            alert('Sorry, your browser does not support getUserMedia :(');
        if ( ! WebSocket)
            alert('Sorry, your browser does not support WebSockets :(');
        if ( ! RTCPeerConnection)
            alert('Sorry, your browser does not support WebRTC :(');
    }

    function initWebSocket() {
        var prot = 'ws' + (window.location.protocol == 'https:' ? 's' : '')  + '://';
        var ws_url = prot + window.location.hostname + ':' + window.location.port + '/';
        log('Connecting to WebSocket URL:', ws_url);
        ws = new WebSocket(ws_url);
        ws.onmessage = gotMessageFromServer;
        log('Success! Connected ws:', ws);
    }

    /**
     * Return true if local media stream is connected.
     */
    function isLocalStream() {
        return localStream && localStream.active;
    }

    function connectUserMedia() {
        log('STATUS isLocalStream:', isLocalStream());
        if (isLocalStream()) return Promise.resolve(); // don't connect again.

        if ('mediaDevices' in navigator) {
            return navigator.mediaDevices.getUserMedia(constraints).then(getUserMediaSuccess);
        } else {
            return new Promise(function(resolve, reject) {
                navigator.getUserMedia(
                    constraints, 
                    stream => { getUserMediaSuccess(stream); resolve(); }, 
                    error => reject(error)
                );
            });
        }
    }

    function getUserMediaSuccess(stream) {
        log('User media stream connected.');

        if ('mozSrcObject' in localVideo) {
            localVideo.mozSrcObject = stream;
            localVideo.play();
        } else {
            localVideo.src = window.URL.createObjectURL(stream);
        }

        localStream = stream;
    }

    function getUserMediaError(error) {
        console.error(error);
    }

    function sendMessage(message) {
        log('Send a message via WebSocket:', message);
        if (typeof message === 'string') {
            // convert a string message into an object first.
            message = {control: message};
        }
        message.clientId = clientId;
        ws.send(JSON.stringify(message));
    }

    function gotMessageFromServer(message) {
        var signal = JSON.parse(message.data);

        if (signal.clientId && signal.clientId == clientId) {
            // This is my own message echoed back to me. Ignore.
            log('Ignored my echoed message.');
            return;
        }

        if (signal.control) {
            // Control messages to close connection, join groups, etc.
            switch(signal.control) {
                case 'bye': {
                    log('Received "bye" from peer, stopping media.');
                    stop();
                }
            }
            return;
        }

        if (!peerConnection) {
            log('No peerConnection yet, calling start() to create one.');
            start(false);
        }

        // ### webrtc.js:218 DOMException: CreateAnswer can't be called before SetRemoteDescription #################
        // ### Happens only on the phone, maybe because its too slow to get the media started up?
        if (signal.sdp) {
            log('That is an "sdp" signal. Set as Remote Description.');
            connectUserMedia().then(function() {
                peerConnection.setRemoteDescription(
                    new RTCSessionDescription(signal.sdp),
                    function _success() {
                        log('Remote Description set, now create answer.');
                        peerConnection.createAnswer(gotDescription, createAnswerError);
                    },
                    function _error(error) {
                        console.error(error);
                    }
                );
            });
        }

        if (signal.ice) {
            log('That is an "ice" signal. Add as IceCandidate.');
            peerConnection.addIceCandidate(new RTCIceCandidate(signal.ice));
        }
    }

    function gotDescription(description) {
        log('Got peerConnection description:', description);
        peerConnection.setLocalDescription(
            description,
            function () { sendMessage({'sdp': description}); },
            function(error) { console.error('set description error', error); }
        );
    }

    function gotIceCandidate(event) {
        log("Got ice candidate event:", event);
        if (event.candidate != null) {
            sendMessage({'ice': event.candidate});
        }
    }

    function gotRemoteStream(event) {
        log("Got remote stream event:", event);
        remoteVideo.src = window.URL.createObjectURL(event.stream);
    }

    function removeRemoteStream(event) {
        log("Remove remote stream event:", event);
        peerConnection = null;
    }

    function createOfferError(error) {
        console.error(error);
    }

    function createAnswerError(error) {
        console.error(error);
    }



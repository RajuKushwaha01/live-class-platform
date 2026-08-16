class WebRTCManager {
  constructor(socket, localStream) {
    this.socket = socket;
    this.localStream = localStream;
    this.peers = {};
    this.pendingCandidates = {};
    this.config = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        // ⭐ Add a TURN server here for participants behind strict corporate/mobile NATs.
        // STUN alone fails to connect ~10-15% of real-world network pairs.
        // Free option for testing: https://www.metered.ca/tools/openrelay/
        // { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      ],
    };
  }

  createPeerConnection(remoteSocketId, onRemoteStream, onConnState) {
    const pc = new RTCPeerConnection(this.config);
    this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream));

    pc.ontrack = (event) => onRemoteStream(remoteSocketId, event.streams[0]);

    pc.onicecandidate = (event) => {
      if (event.candidate) this.socket.emit("webrtc-ice-candidate", { to: remoteSocketId, candidate: event.candidate });
    };

    pc.onconnectionstatechange = () => {
      onConnState && onConnState(remoteSocketId, pc.connectionState);
      // Auto-recover from a dropped connection
      if (pc.connectionState === "failed") {
        this.restartIce(remoteSocketId);
      }
    };

    this.peers[remoteSocketId] = pc;
    this.pendingCandidates[remoteSocketId] = [];
    return pc;
  }

  async restartIce(remoteSocketId) {
    const pc = this.peers[remoteSocketId];
    if (!pc) return;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.socket.emit("webrtc-offer", { to: remoteSocketId, offer });
    } catch (e) {
      console.error("ICE restart failed:", e);
    }
  }

  async callUser(remoteSocketId, onRemoteStream, onConnState) {
    const pc = this.createPeerConnection(remoteSocketId, onRemoteStream, onConnState);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.emit("webrtc-offer", { to: remoteSocketId, offer });
  }

  async handleOffer(fromSocketId, offer, onRemoteStream, onConnState) {
    let pc = this.peers[fromSocketId];
    if (!pc) pc = this.createPeerConnection(fromSocketId, onRemoteStream, onConnState);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this._flushQueued(fromSocketId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.emit("webrtc-answer", { to: fromSocketId, answer });
  }

  async handleAnswer(fromSocketId, answer) {
    const pc = this.peers[fromSocketId];
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this._flushQueued(fromSocketId);
  }

  async handleIceCandidate(fromSocketId, candidate) {
    const pc = this.peers[fromSocketId];
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      this.pendingCandidates[fromSocketId] = this.pendingCandidates[fromSocketId] || [];
      this.pendingCandidates[fromSocketId].push(candidate);
      return;
    }
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch (e) { console.error("ICE candidate error:", e); }
  }

  async _flushQueued(socketId) {
    const queue = this.pendingCandidates[socketId] || [];
    const pc = this.peers[socketId];
    for (const c of queue) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); }
      catch (e) { console.error("Queued ICE error:", e); }
    }
    this.pendingCandidates[socketId] = [];
  }

  closePeer(socketId) {
    if (this.peers[socketId]) {
      this.peers[socketId].close();
      delete this.peers[socketId];
      delete this.pendingCandidates[socketId];
    }
  }

  toggleAudio(enabled) { this.localStream.getAudioTracks().forEach((t) => (t.enabled = enabled)); }
  toggleVideo(enabled) { this.localStream.getVideoTracks().forEach((t) => (t.enabled = enabled)); }

  async replaceVideoTrack(newTrack) {
    Object.values(this.peers).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(newTrack);
    });
  }
}
/**
 * Voice, camera and screen-share media for a voice channel (WebRTC mesh).
 *
 * One RTCPeerConnection per other user in the channel. Signaling goes through
 * the server's webrtc:offer / webrtc:answer / webrtc:ice-candidate relay
 * (server/socket/socketHandler.js). Uses the "perfect negotiation" pattern
 * (https://w3c.github.io/webrtc-pc/#perfect-negotiation-example): both sides
 * may start a negotiation whenever a camera or screen share is added or
 * removed, and the "polite" peer (larger user id) backs off on a collision.
 * Who joined last therefore doesn't matter, and renegotiation needs no extra protocol.
 *
 * ponytail: full mesh, so every user uploads one copy per listener. Fine for
 * LAN-party sizes (~8 people); bigger rooms want an SFU (mediasoup/LiveKit).
 * ponytail: STUN only. Works on a LAN, over Tailscale and on most home NATs;
 * strict/symmetric NAT needs a TURN server added to ICE_SERVERS.
 *
 * app.js wires it up: rtc.join() on voice:currentUsers, rtc.peerLeft() on
 * voice:userLeft, rtc.addStream()/removeStream() for camera and screen share,
 * and supplies onRemoteVideo/onRemoteVideoGone to draw tiles.
 */
(() => {
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

  let socket = null;
  let selfId = null;
  const peers = new Map(); // userId -> peer
  const local = new Map(); // streamId -> { stream, meta }
  let deafened = false;
  let outputDevice = null;

  const localMeta = () => Object.fromEntries([...local].map(([id, l]) => [id, l.meta]));

  function peer(id) {
    let p = peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    p = { id, pc, polite: String(selfId) > String(id), makingOffer: false, ignoreOffer: false,
      queue: Promise.resolve(), senders: new Map(), meta: {}, audio: new Map(), videos: new Map() };
    peers.set(id, p);

    // Game Together controller input. Pre-negotiated (same id on both sides), so it rides the
    // first offer with no extra signaling. Unordered, no retransmits: each message is the whole
    // pad state, so a lost one is replaced 16 ms later instead of holding up newer ones.
    p.dc = pc.createDataChannel('input', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    p.dc.onmessage = (e) => api.onData?.(id, e.data);

    for (const { stream } of local.values()) addTracks(p, stream);

    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        socket.emit('webrtc:offer', { targetUserId: id, offer: pc.localDescription, meta: localMeta() });
      } catch (e) {
        console.error('[rtc] offer failed', e);
      } finally {
        p.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('webrtc:ice-candidate', { targetUserId: id, candidate });
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      if (track.kind === 'audio') return playAudio(p, stream);
      if (p.videos.has(stream.id)) return;
      const meta = p.meta[stream.id] || { kind: 'camera', label: 'Camera' };
      p.videos.set(stream.id, { stream, meta });
      api.onRemoteVideo?.(id, stream, meta);
      // The sender removing its tracks fires removetrack here (renegotiation).
      stream.onremovetrack = () => {
        if (!stream.getVideoTracks().length) videoGone(p, stream.id);
      };
    };
    return p;
  }

  function addTracks(p, stream) {
    for (const t of stream.getTracks()) {
      if (!p.senders.has(t.id)) p.senders.set(t.id, p.pc.addTrack(t, stream));
    }
  }

  function videoGone(p, streamId) {
    if (!p.videos.delete(streamId)) return;
    api.onRemoteVideoGone?.(p.id, streamId);
  }

  function playAudio(p, stream) {
    let el = p.audio.get(stream.id);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.dataset.peer = p.id;
      el.className = 'rtc-audio';
      el.style.display = 'none';
      document.body.appendChild(el);
      p.audio.set(stream.id, el);
    }
    el.srcObject = stream;
    el.muted = deafened;
    if (outputDevice && el.setSinkId) el.setSinkId(outputDevice).catch(() => {});
    el.play().catch(() => {}); // autoplay may need a gesture; joining voice is one
  }

  // Run each peer's signaling steps in order: an ICE candidate can arrive
  // while the offer it belongs to is still being applied.
  const serial = (id, fn) => {
    const p = peer(id);
    p.queue = p.queue.then(() => fn(p)).catch((e) => console.error('[rtc] signaling', e));
  };

  function onDescription({ fromUserId, offer, answer, meta }) {
    const description = offer || answer;
    serial(String(fromUserId), async (p) => {
      if (meta) p.meta = meta;
      const pc = p.pc;
      const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        socket.emit('webrtc:answer', { targetUserId: p.id, answer: pc.localDescription, meta: localMeta() });
      }
    });
  }

  function onCandidate({ fromUserId, candidate }) {
    serial(String(fromUserId), async (p) => {
      try { await p.pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
    });
  }

  function closePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    p.pc.close();
    for (const el of p.audio.values()) { el.srcObject = null; el.remove(); }
    for (const sid of [...p.videos.keys()]) videoGone(p, sid);
    peers.delete(id);
  }

  const api = {
    onRemoteVideo: null,
    onRemoteVideoGone: null,
    onData: null, // (userId, string): Game Together input from a peer

    /** Attach to the app's socket once; call again after a reconnect. */
    attach(s) {
      if (socket === s) return;
      socket = s;
      s.on('webrtc:offer', onDescription);
      s.on('webrtc:answer', onDescription);
      s.on('webrtc:ice-candidate', onCandidate);
    },

    /** Entered a voice channel: connect to everyone already there. */
    join(me, users, micStream) {
      selfId = String(me);
      if (micStream) local.set(micStream.id, { stream: micStream, meta: { kind: 'mic' } });
      for (const u of users) {
        const id = String(u?._id || u?.id || u);
        if (id && id !== selfId) peer(id); // adding our tracks triggers the offer
      }
    },

    peerLeft(id) { closePeer(String(id)); },

    leave() {
      for (const id of [...peers.keys()]) closePeer(id);
      local.clear();
    },

    /** Share a camera or screen stream with everyone in the channel. */
    addStream(stream, meta) {
      local.set(stream.id, { stream, meta });
      for (const p of peers.values()) addTracks(p, stream);
    },

    removeStream(stream) {
      if (!local.delete(stream.id)) return;
      for (const p of peers.values()) {
        for (const t of stream.getTracks()) {
          const sender = p.senders.get(t.id);
          if (sender) { p.pc.removeTrack(sender); p.senders.delete(t.id); }
        }
      }
    },

    setDeafened(on) {
      deafened = on;
      document.querySelectorAll('audio.rtc-audio').forEach((el) => { el.muted = on; });
    },

    setOutputDevice(deviceId) {
      outputDevice = deviceId || null;
      document.querySelectorAll('audio.rtc-audio').forEach((el) => el.setSinkId?.(outputDevice || '').catch(() => {}));
    },

    /** Bytes received from all peers, by kind: proof media is flowing (harness, debugging). */
    async stats() {
      const out = { audio: 0, video: 0 };
      for (const p of peers.values()) {
        (await p.pc.getStats()).forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind in out) out[r.kind] += r.bytesReceived || 0;
        });
      }
      return out;
    },

    /** Send a small message (Game Together input) straight to one user. False if not connected. */
    send(id, data) {
      const dc = peers.get(String(id))?.dc;
      if (dc?.readyState !== 'open') return false;
      dc.send(data);
      return true;
    },

    /** A user's screen share (or else camera) stream, if they're sending one. */
    remoteVideo(id) {
      const vids = [...(peers.get(String(id))?.videos.values() || [])];
      return (vids.find((v) => v.meta.kind === 'screen') || vids[0])?.stream || null;
    },

    /** For the conformance harness and debugging. */
    peers() {
      return [...peers.values()].map((p) => ({ id: p.id, state: p.pc.connectionState, input: p.dc.readyState, videos: [...p.videos.keys()] }));
    },
  };
  window.rtc = api;
})();

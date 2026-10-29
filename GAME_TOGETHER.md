# Game Together - Virtual Controller Emulation

Game Together is a feature that allows multiple players to play local multiplayer games together remotely by mapping their controllers to virtual controllers on the host's system.

## How It Works

1. **Host (Player 1)**: The person running the game starts a Game Together session. They use their physical controller as Player 1.

2. **Remote Players (Player 2, 3, 4, etc.)**: Other users in the voice channel can join the session. Their controller inputs are sent over the network and mapped to virtual Xbox controllers (Player 2, 3, 4, etc.) on the host's system.

3. **Universal Compatibility**: Works with **any** game that supports local multiplayer - not limited to specific emulators!

## Usage

### For the Host (Player 1):

1. Join a voice channel
2. Start your game
3. Start screen sharing to show your game
4. Click the "🎮 Play Together" button on your own screen share
5. Select "Start Session"
6. Your friends can now join as Players 2, 3, 4, etc.

### For Remote Players (Player 2+):

1. Join the same voice channel as the host
2. Connect your game controller (Xbox, PlayStation, etc.)
3. Click the "🎮 Play Together" button on the host's screen share
4. Select "Join Session"
5. You'll be assigned a player slot (Player 2, 3, or 4)
6. Your controller will now control that player in the host's game!

## Platform Support & Setup

### Windows (Recommended)

**Requirements:**
- ViGEmBus driver (creates virtual Xbox 360 controllers)

**Installation:**
1. Download ViGEmBus from: https://github.com/ViGEm/ViGEmBus/releases
2. Install the driver
3. Restart Emberlan server
4. Game Together will automatically detect and use ViGEmBus

### Linux

**Requirements:**
- `uinput` kernel module (usually pre-installed)

**Setup:**
```bash
# Load uinput module
sudo modprobe uinput

# Make uinput accessible (temporary)
sudo chmod 666 /dev/uinput

# Make uinput accessible permanently
echo 'KERNEL=="uinput", MODE="0666"' | sudo tee /etc/udev/rules.d/99-uinput.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

### macOS

**Status:** Virtual controller support on macOS requires additional drivers.

**Alternatives:**
- Use Parsec or similar game streaming service for macOS hosts
- Use Windows/Linux as the host

## Development Mode

When running without proper drivers installed, Game Together will operate in "mock mode" for testing purposes. This allows you to test the feature but won't actually create virtual controllers.

To check if drivers are properly installed:
1. Go to Admin Panel → Game Together
2. Check the "Backend Available" status
3. If false, install the required drivers for your platform

## Supported Controllers

Game Together supports any controller compatible with the HTML5 Gamepad API:
- Xbox controllers (wired and wireless)
- PlayStation controllers (DualShock 4, DualSense)
- Nintendo Switch Pro Controller
- Generic USB/Bluetooth controllers

## Technical Details

### Controller Mapping

Remote controller inputs are mapped to standard Xbox 360 controller layout:

**Buttons:**
- A, B, X, Y
- LB (Left Bumper), RB (Right Bumper)
- BACK (Select), START
- LS (Left Stick Click), RS (Right Stick Click)
- D-Pad (Up, Down, Left, Right)
- GUIDE (Xbox button)

**Axes:**
- Left Stick (X, Y)
- Right Stick (X, Y)
- LT (Left Trigger), RT (Right Trigger)

### Network Performance

- Input polling: 60 Hz (~16ms intervals)
- Input transmission: Socket.IO (low latency)
- Max update rate: 60 updates/second
- Typical latency: 20-50ms (depends on network)

### Limitations

- Maximum 4 players per session (can be increased to 7 for specific games)
- Host must have sufficient bandwidth for screen sharing + voice
- Input latency depends on network quality
- Some games may not work well with virtual controllers (rare)

## Comparison to Emulator Mode

| Feature | Game Together | Old Emulator Mode |
|---------|---------------|-------------------|
| **Game Compatibility** | Any local multiplayer game | Only specific emulators |
| **Setup** | Start session, join, play | Install emulator + ROMs |
| **Platform** | Universal | Platform-specific |
| **Configuration** | None required | ROM paths, emulator settings |
| **Host Control** | Uses physical controller | Emulator handles input |

## Troubleshooting

### "Virtual controller backend not available"
- **Windows:** Install ViGEmBus driver
- **Linux:** Enable uinput module and set permissions
- **macOS:** Currently unsupported

### "Controller not detected"
- Plug in your controller and wait a few seconds
- Check browser permissions for gamepad access
- Try a different USB port or Bluetooth connection

### "Input lag / delayed response"
- Check your network connection
- Close bandwidth-heavy applications
- Reduce screen share quality if needed
- Ensure host has good upload speed

### "Game doesn't recognize Player 2/3/4"
- Some games require manual controller configuration
- Check game settings for controller assignment
- Try disconnecting and reconnecting controllers
- Restart the Game Together session

## Security & Privacy

- Controller inputs are only sent while in an active session
- Only users in the same voice channel can join
- Host can stop the session at any time
- No game data or files are transmitted (only controller inputs)

## API Reference

### HTTP Endpoints

```
POST /api/admin/game-together/start
  - Start a new Game Together session
  - Body: { channelId }
  - Returns: session info

POST /api/admin/game-together/join
  - Join an existing session
  - Body: { channelId }
  - Returns: { playerSlot }

POST /api/admin/game-together/leave
  - Leave the current session
  - Body: { channelId }

POST /api/admin/game-together/stop
  - Stop the session (host only)
  - Body: { channelId }

POST /api/admin/game-together/input
  - Send controller input (internal use)
  - Body: { channelId, inputData }
```

### Socket.IO Events

```javascript
// Client → Server
'gameTogether:input' - Send controller input
  { channelId, inputData }

// Server → Client
'gameTogether:session-started' - Session started
  { channelId, hostUserId, hostUsername, maxPlayers }

'gameTogether:session-stopped' - Session ended
  { channelId }

'gameTogether:player-joined' - Player joined
  { channelId, userId, username, playerSlot, playerCount }

'gameTogether:player-left' - Player left
  { channelId, userId, playerSlot, playerCount }

'gameTogether:input-received' - Input acknowledged
  { channelId, userId, timestamp }
```

## Future Enhancements

- [ ] Support for more than 4 players
- [ ] Custom controller mapping profiles
- [ ] Input recording and playback
- [ ] macOS native support
- [ ] Mobile controller support (touch controls)
- [ ] Spectator mode with view-only access
- [ ] Input statistics and latency monitoring

## Contributing

Found a bug or have a suggestion? Please open an issue on the Emberlan GitHub repository!

# Development Guide

Everything you need to contribute to Emberlan.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Building](#building)
- [Contributing](#contributing)

---

## Getting Started

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+ or yarn
- MongoDB 6.0+ (local or Docker)
- Git
- A code editor (VS Code recommended)

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/emberlan.git
cd emberlan

# Install server dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..

# Install electron client dependencies
cd electron-client && npm install && cd ..

# Copy environment file
cp .env.example .env
```

### Environment Configuration

Edit `.env` for development:

```env
PORT=3001
NODE_ENV=development
JWT_SECRET=dev-secret-change-in-production
MONGODB_URI=mongodb://localhost:27017/f7lans-dev
SERVER_URL=http://localhost:3001
CLIENT_URL=http://localhost:3000
FEDERATION_ENABLED=true
```

### Starting Development Servers

**Option 1: Run everything manually**

Terminal 1 (MongoDB, if not using Docker):
```bash
mongod
```

Terminal 2 (Backend):
```bash
npm run dev
```

Terminal 3 (Web Client):
```bash
cd client
npm start
```

**Option 2: Windows batch scripts**
```batch
scripts\start-server-dev.bat
```

**Option 3: Docker for dependencies only**
```bash
# Start MongoDB in Docker
docker run -d -p 27017:27017 --name emberlan-mongo mongo:6

# Run app locally
npm run dev
```

---

## Project Structure

```
emberlan/
├── server/                 # Backend application
│   ├── index.js           # Entry point
│   ├── config/            # Configuration files
│   │   ├── database.js    # MongoDB connection
│   │   └── federation.js  # Federation config
│   ├── middleware/        # Express middleware
│   │   └── auth.js        # JWT authentication
│   ├── models/            # Mongoose schemas
│   │   ├── User.js
│   │   ├── Channel.js
│   │   ├── Message.js
│   │   ├── DirectMessage.js
│   │   ├── Invite.js
│   │   └── Federation.js
│   ├── controllers/       # Route handlers
│   │   ├── authController.js
│   │   ├── userController.js
│   │   ├── channelController.js
│   │   ├── adminController.js
│   │   └── federationController.js
│   ├── services/          # Business logic
│   │   └── federationService.js
│   ├── socket/            # WebSocket handlers
│   │   └── socketHandler.js
│   ├── routes/            # API route definitions
│   │   └── api.js
│   └── uploads/           # User uploads
│
├── client/                 # React web application
│   ├── public/            # Static files
│   ├── src/
│   │   ├── App.js         # Main component
│   │   ├── index.js       # Entry point
│   │   ├── components/    # React components
│   │   ├── contexts/      # React contexts
│   │   ├── hooks/         # Custom hooks
│   │   └── services/      # API services
│   └── package.json
│
├── electron-client/        # Desktop application
│   ├── main.js            # Main process
│   ├── preload.js         # Preload scripts
│   ├── renderer/          # Renderer process
│   └── package.json
│
├── scripts/               # Build & utility scripts
│   ├── setup.bat
│   ├── start-server.bat
│   ├── build-electron.bat
│   └── ...
│
├── docs/                  # Documentation
│   ├── INSTALLATION.md
│   ├── FEDERATION.md
│   ├── API.md
│   ├── ARCHITECTURE.md
│   └── DEVELOPMENT.md
│
├── docker-compose.yml     # Docker configuration
├── Dockerfile            # Server container
├── package.json          # Root dependencies
└── .env.example          # Environment template
```

---

## Development Workflow

### Branch Strategy

```
main              # Stable release branch
  └── develop     # Development integration
        ├── feature/xyz    # New features
        ├── fix/abc        # Bug fixes
        └── docs/readme    # Documentation
```

### Creating a Feature

```bash
# Create feature branch
git checkout develop
git pull origin develop
git checkout -b feature/my-feature

# Make changes...

# Commit with conventional commits
git add .
git commit -m "feat: add awesome feature"

# Push and create PR
git push -u origin feature/my-feature
```

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting (no code change)
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance

Examples:
```
feat(auth): add password reset flow
fix(chat): resolve message ordering issue
docs(api): add federation endpoints
refactor(socket): extract voice handlers
```

---

## Coding Standards

### JavaScript/Node.js

```javascript
// Use const/let, never var
const immutable = 'value';
let mutable = 'value';

// Use async/await over callbacks
async function fetchData() {
  try {
    const result = await someAsyncOperation();
    return result;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Use arrow functions for callbacks
const items = array.map(item => item.value);

// Destructuring
const { name, email } = user;
const [first, second] = array;

// Template literals
const message = `Hello, ${name}!`;

// Object shorthand
const user = { name, email, role };
```

### File Naming

- Components: `PascalCase.js` (e.g., `UserProfile.js`)
- Utilities: `camelCase.js` (e.g., `formatDate.js`)
- Constants: `UPPER_SNAKE_CASE.js` (e.g., `API_ENDPOINTS.js`)
- Styles: `component-name.css` (e.g., `user-profile.css`)

### React Components

```jsx
// Functional components with hooks
import React, { useState, useEffect } from 'react';

function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUser() {
      try {
        const data = await api.getUser(userId);
        setUser(data);
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, [userId]);

  if (loading) return <Loading />;
  if (!user) return <NotFound />;

  return (
    <div className="user-profile">
      <Avatar src={user.avatar} />
      <h2>{user.displayName}</h2>
    </div>
  );
}

export default UserProfile;
```

### Error Handling

```javascript
// Controller error handling
const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        error: 'USER_NOT_FOUND'
      });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: 'SERVER_ERROR'
    });
  }
};
```

---

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- --grep "auth"

# Watch mode
npm run test:watch
```

### Writing Tests

```javascript
// tests/auth.test.js
const request = require('supertest');
const app = require('../server');

describe('Auth API', () => {
  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'testpass'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.username).toBe('testuser');
    });

    it('should reject invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'wrongpass'
        });

      expect(res.status).toBe(401);
    });
  });
});
```

### Test Database

```javascript
// tests/setup.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});
```

---

## Building

### Production Build

**Server:**
```bash
# No build step needed for Node.js
NODE_ENV=production npm start
```

**Web Client:**
```bash
cd client
npm run build
# Output: client/build/
```

**Electron Client:**
```bash
cd electron-client
npm run build
# Output: electron-client/dist/
```

### Docker Build

```bash
# Build all containers
docker-compose build

# Build specific service
docker-compose build server

# Build with no cache
docker-compose build --no-cache
```

### Windows Builds

```batch
:: Build everything
scripts\rebuild-all.bat

:: Build Electron only
scripts\build-electron.bat

:: Build all Electron variants
scripts\build-electron-all.bat
```

---

## Contributing

### Before You Start

1. Check existing [issues](https://github.com/yourusername/emberlan/issues)
2. For major changes, open an issue first to discuss
3. Read this development guide

### Pull Request Process

1. **Fork** the repository
2. **Clone** your fork
3. **Create** a feature branch
4. **Make** your changes
5. **Test** your changes
6. **Commit** with conventional commits
7. **Push** to your fork
8. **Open** a Pull Request

### PR Checklist

- [ ] Code follows project style guide
- [ ] Tests added/updated for changes
- [ ] Documentation updated if needed
- [ ] No console.log statements (use proper logging)
- [ ] No hardcoded values (use config/env)
- [ ] PR description explains the changes

### Code Review

- All PRs require at least one review
- Address reviewer feedback
- Keep PRs focused and reasonably sized
- Squash commits before merge if requested

---

## Debugging

### Server Debugging

```bash
# Enable debug output
DEBUG=emberlan:* npm run dev

# Node.js inspector
node --inspect server/index.js
```

Then open `chrome://inspect` in Chrome.

### Client Debugging

React DevTools and Redux DevTools are helpful:
- [React DevTools](https://chrome.google.com/webstore/detail/react-developer-tools/)
- Browser console for network/errors

### Socket.IO Debugging

```bash
# Server-side
DEBUG=socket.io* npm run dev

# Client-side (in browser console)
localStorage.debug = 'socket.io-client:*';
```

### MongoDB Debugging

```bash
# Connect to database
mongosh mongodb://localhost:27017/f7lans

# Common queries
db.users.find().pretty()
db.messages.find({ channel: ObjectId("...") }).sort({ createdAt: -1 }).limit(10)
```

---

## Useful Commands

```bash
# Check for outdated dependencies
npm outdated

# Update dependencies
npm update

# Security audit
npm audit

# Clean node_modules
rm -rf node_modules && npm install

# Reset database (development)
mongosh emberlan-dev --eval "db.dropDatabase()"
```

---

## Getting Help

- **Documentation**: Check `/docs` folder
- **Issues**: [GitHub Issues](https://github.com/yourusername/emberlan/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/emberlan/discussions)

Happy coding!

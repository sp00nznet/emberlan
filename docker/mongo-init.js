// MongoDB Initialization Script for Emberlan
// This script runs when the MongoDB container is first created

db = db.getSiblingDB("f7lans");

// Create collections with validation
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      // password is intentionally NOT required: OAuth (Google) users have no
      // password. The Mongoose model enforces "password required unless googleId"
      // at the app layer; the DB validator only guards the always-present fields.
      required: ['username', 'email'],
      properties: {
        username: {
          bsonType: 'string',
          minLength: 3,
          maxLength: 32
        },
        email: {
          bsonType: 'string'
        },
        password: {
          bsonType: ['string', 'null']
        },
        role: {
          enum: ['user', 'moderator', 'admin', 'superadmin']
        }
      }
    }
  }
});

db.createCollection('channels');
db.createCollection('messages');
db.createCollection('directmessages');
db.createCollection('invites');

// Create indexes for better performance
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ steamId: 1 }, { sparse: true });

db.messages.createIndex({ channel: 1, createdAt: -1 });
db.messages.createIndex({ author: 1, createdAt: -1 });

db.directmessages.createIndex({ participants: 1, createdAt: -1 });

db.invites.createIndex({ code: 1 }, { unique: true });
db.invites.createIndex({ email: 1 });
db.invites.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

print('Emberlan database initialized successfully!');

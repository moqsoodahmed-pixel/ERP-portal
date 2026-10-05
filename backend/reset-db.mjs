import 'dotenv/config';
import mongoose from 'mongoose';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production');

await mongoose.connect(process.env.MONGODB_URI);
console.log('Dropping database:', mongoose.connection.name);
await mongoose.connection.dropDatabase();
await mongoose.disconnect();
console.log('Done.');
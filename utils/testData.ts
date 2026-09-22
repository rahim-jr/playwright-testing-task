import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  baseUrl: process.env.BASE_URL || 'https://eticket.railway.gov.bd',
  mobileNumber: process.env.RAILWAY_MOBILE_NUMBER || '',
  password: process.env.RAILWAY_PASSWORD || '',
  fromStation: process.env.FROM_STATION || 'Dhaka',
  toStation: process.env.TO_STATION || 'Chattogram',
  journeyDate: process.env.JOURNEY_DATE || '',
  journeyClass: process.env.JOURNEY_CLASS || 'SNIGDHA',
  trainNumber: process.env.TRAIN_NUMBER || '',
  headless: process.env.HEADLESS !== 'false',
};

const OBJECT_ID = /^[a-f\d]{24}$/i;
export const isObjectId = (v) => (typeof v === 'string' || (v && v._bsontype)) && OBJECT_ID.test(String(v));

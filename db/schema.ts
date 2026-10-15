import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
// Operational counts are separate from owner-scoped visit records.
export const usageBuckets = sqliteTable('usage_buckets', {
  bucket: text('bucket').primaryKey(),
  count: integer('count').notNull().default(0),
});

export const visits = sqliteTable('visits', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  transcript: text('transcript').notNull().default(''),
  note: text('note').notNull().default(''),
  originalNote: text('original_note'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  revision: integer('revision').notNull().default(1),
}, table => [index('visits_owner_updated').on(table.ownerId,table.updatedAt)]);

export const testEvents = sqliteTable('test_events', {
 id:text('id').primaryKey(), userId:text('user_id').notNull(), email:text('email').notNull(), displayName:text('display_name').notNull(),
 stage:text('stage').notNull(), provider:text('provider').notNull(), status:text('status').notNull(),
 startedAt:integer('started_at').notNull(), elapsedMs:integer('elapsed_ms'), durationMs:integer('duration_ms'), errorCode:integer('error_code'),
 visitId:text('visit_id'),runId:text('run_id'),model:text('model'),audioBytes:integer('audio_bytes'),audioFormat:text('audio_format'),diagnostics:text('diagnostics'),
}, table=>[index('test_events_user_started').on(table.userId,table.startedAt)]);

export const feedback = sqliteTable('feedback', {
 id:text('id').primaryKey(), ownerId:text('owner_id').notNull(), email:text('email').notNull(),
 visitId:text('visit_id').notNull(), original:text('original').notNull(), originalKind:text('original_kind').notNull(),
 corrected:text('corrected').notNull(), comment:text('comment').notNull(), createdAt:integer('created_at').notNull(),
},t=>[index('feedback_owner_visit').on(t.ownerId,t.visitId),index('feedback_created').on(t.createdAt)]);

export const visitAudio=sqliteTable('visit_audio',{
 id:text('id').primaryKey(),visitId:text('visit_id').notNull(),ownerId:text('owner_id').notNull(),
 objectKey:text('object_key').notNull(),mime:text('mime').notNull(),bytes:integer('bytes').notNull(),durationMs:integer('duration_ms'),
 digest:text('digest').notNull(),createdAt:integer('created_at').notNull(),
},t=>[index('visit_audio_owner_visit').on(t.ownerId,t.visitId)]);

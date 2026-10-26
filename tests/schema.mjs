import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
db.exec(`INSERT INTO users VALUES ('owner','access-sub','owner@example.test','2026-10-23T00:00:00Z');
INSERT INTO settings(user_id,updated_at) VALUES ('owner','2026-10-23T00:00:00Z');
INSERT INTO profiles(user_id,updated_at) VALUES ('owner','2026-10-23T00:00:00Z');`);
let checks = 0;
function check(name, fn) { fn(); checks++; process.stdout.write(`PASS ${name}\n`); }
function addJob(id, classification, max = 2) {
  db.prepare(`INSERT INTO jobs(id,company,title,normalized_title,description,job_url,fingerprint,
    first_seen_at,last_seen_at,content_hash,created_at,updated_at,
    experience_status,experience_max,role_status,location_status,availability,decision_settings_revision)
    VALUES (?, 'Example','Software Engineer','software engineer','0-2 years','https://example.test/job',?,
    '2026-10-23T00:00:00Z','2026-10-23T00:00:00Z','hash','2026-10-23T00:00:00Z','2026-10-23T00:00:00Z',
    ?,?,'ELIGIBLE','COMPATIBLE','OPEN',1)`).run(id,id,classification,max);
}
check('schema and foreign keys initialize', () => assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1));
check('experience settings cannot exceed two', () => assert.throws(() => db.exec('UPDATE settings SET maximum_experience=3')));
check('eligible structured maximum cannot exceed two', () => assert.throws(() => addJob('bad','ELIGIBLE',3)));
addJob('eligible','ELIGIBLE'); addJob('review','REVIEW_REQUIRED'); addJob('reject','NOT_ELIGIBLE',5);
check('recommendation view excludes review and rejected jobs', () => assert.deepEqual(db.prepare('SELECT id FROM recommended_jobs').all().map(x=>x.id),['eligible']));
check('closed jobs disappear', () => {
  db.exec("UPDATE jobs SET availability='CLOSED' WHERE id='eligible'");
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recommended_jobs').get().n,0);
  db.exec("UPDATE jobs SET availability='OPEN' WHERE id='eligible'");
});
check('settings revisions invalidate previous decisions', () => {
  db.exec('UPDATE settings SET revision=2');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recommended_jobs').get().n,0);
  db.exec('UPDATE settings SET revision=1');
});
db.exec(`INSERT INTO applications(id,user_id,job_id,apply_url,status,transition_actor,transition_reason,
transition_event_key,created_at,updated_at) VALUES('app','owner','eligible','https://example.test/apply',
'APPLIED','owner','manual application','event-1','2026-10-23T00:00:00Z','2026-10-23T00:00:00Z')`);
check('application insertion creates initial history', () => assert.equal(db.prepare('SELECT COUNT(*) AS n FROM application_status_history').get().n,1));
check('duplicate mark-applied violates owner/job uniqueness', () => assert.throws(() => db.exec(`INSERT INTO applications
(id,user_id,job_id,apply_url,status,transition_actor,transition_reason,transition_event_key,created_at,updated_at)
SELECT 'app-duplicate',user_id,job_id,apply_url,status,transition_actor,transition_reason,transition_event_key,created_at,updated_at FROM applications`)));
check('transition writes history atomically', () => {
  db.exec("UPDATE applications SET status='INTERVIEW',transition_event_key='event-2' WHERE id='app'");
  const row = db.prepare('SELECT from_status,to_status FROM application_status_history ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.from_status,'APPLIED'); assert.equal(row.to_status,'INTERVIEW');
});
check('reused event key rolls back status mutation', () => {
  assert.throws(() => db.exec("UPDATE applications SET status='OFFER' WHERE id='app'"));
  assert.equal(db.prepare("SELECT status FROM applications WHERE id='app'").get().status,'INTERVIEW');
});
check('history is append-only', () => {
  assert.throws(() => db.exec("UPDATE application_status_history SET to_status='OFFER'"));
  assert.throws(() => db.exec('DELETE FROM application_status_history'));
});
check('notification intent deduplicates', () => {
  db.exec("INSERT INTO notifications(id,user_id,channel,event_key,state,created_at) VALUES('n1','owner','TELEGRAM','new-job','PENDING','now')");
  assert.throws(() => db.exec("INSERT INTO notifications(id,user_id,channel,event_key,state,created_at) VALUES('n2','owner','TELEGRAM','new-job','PENDING','now')"));
});
check('migration has no foreign-key violations', () => assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]));
db.close();
process.stdout.write(`${checks} schema checks passed. Runtime, parser and browser tests are still pending implementation.\n`);

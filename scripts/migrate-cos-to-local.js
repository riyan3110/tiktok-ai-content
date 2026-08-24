const { createDatabase } = require('../src/db');
const { StorageService } = require('../src/storage/service');
const { migrateTencentCosToLocal, useVpsLocalStorage } = require('../src/storage/vpsStorage');

async function main() {
  const db = createDatabase();
  const storage = new StorageService({ db });
  try {
    // New files must stay local even if an old COS object cannot be migrated.
    useVpsLocalStorage(db);
    const result = await migrateTencentCosToLocal({ db, storage, deleteSource: true });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed.length) process.exitCode = 2;
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error('Migrasi COS -> VPS gagal:', error.message);
  process.exitCode = 1;
});

const assert = require('node:assert');
const { GameManager } = require('../src/game/GameManager');
const flow = require('../src/game/flow');

function createMockClient() {
  const dmsSent = [];
  return {
    client: {
      users: {
        fetch: async (userId) => ({
          id: userId,
          send: async (content) => { dmsSent.push({ userId, content }); return {}; },
        }),
      },
    },
    dmsSent,
  };
}

async function run() {
  const gm = new GameManager();
  const { client, dmsSent } = createMockClient();
  const guildId = 'g_recap';

  gm.createGame(guildId, 'chan1', 'host1');
  for (const id of ['p1', 'p2', 'p3']) gm.join(guildId, id);
  gm.setSelectedRoles(guildId, 'host1', ['BAO_VE', 'CAVE']);
  const game = gm.startGame(guildId, 'host1');

  const guard = [...game.players.values()].find((p) => p.roleId === 'BAO_VE');
  const cave = [...game.players.values()].find((p) => p.roleId === 'CAVE');
  const other = [...game.players.values()].find((p) => p.roleId === 'DAN_THUONG');

  gm.submitGuardTarget(game, guard.userId, other.userId);
  gm.submitCaveTarget(game, cave.userId, 'ALONE');

  await flow.sendHostNightRecap(client, game);

  assert.strictEqual(dmsSent.length, 1, 'Phai gui DUY NHAT 1 tin DM cho host');
  assert.strictEqual(dmsSent[0].userId, 'host1', 'Phai gui dung cho host, khong phai ai khac');
  assert.match(dmsSent[0].content, /Bảo Vệ.*chọn.*bảo vệ/i, 'Phai neu ro Bao Ve bao ve ai');
  assert.match(dmsSent[0].content, /Cave.*chọn.*ngủ một mình/i, 'Phai neu ro Cave ngu mot minh');
  console.log('✅ OK: sendHostNightRecap DM đúng cho host, nêu rõ Bảo Vệ bảo vệ ai và Cave ngủ với ai/một mình');

  console.log('\n=== TEST HOST RECAP PASS ===');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

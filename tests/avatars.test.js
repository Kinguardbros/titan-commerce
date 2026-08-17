import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P1-23 (Docs/AUDIT-2026-08.md): lib/actions/avatars.js was only lightly
// covered. This file adds RBAC gates + core behavior for the persona-avatar
// lifecycle: generate (fal.ai routing, edit-vs-text-to-image), set reference
// (plain URL vs temporary fal.ai URL re-upload), and delete (DB row +
// Storage cleanup).
//
// A bespoke chainable Supabase mock is used (rather than the generic
// "makeBuilder" convention from tests/rate-limit-per-tenant.test.js) because
// this file needs to assert on the EXACT payload passed to .insert()/
// .update()/.delete() — the generic builder's update()/delete() drop their
// arguments, which is fine for pure permission-gate tests elsewhere but not
// enough here.
// ---------------------------------------------------------------------------

function makeTable({ single, list, onInsert, onUpdate, onDelete } = {}) {
  const c = {
    select: () => c,
    eq: () => c,
    not: () => c,
    is: () => c,
    order: () => c,
    limit: () => c,
    single: async () => (single ? single() : { data: null, error: null }),
    insert: (row) => {
      const result = onInsert ? onInsert(row) : { data: null, error: null };
      const p = Promise.resolve(result);
      p.select = () => ({ single: async () => result });
      return p;
    },
    update: (patch) => {
      const eqArgsList = [];
      const uchain = {
        eq: (...args) => { eqArgsList.push(args); return uchain; },
        then: (resolve, reject) => Promise.resolve(onUpdate ? onUpdate(patch, eqArgsList) : { data: null, error: null }).then(resolve, reject),
      };
      return uchain;
    },
    delete: () => {
      const eqArgsList = [];
      const dchain = {
        eq: (...args) => { eqArgsList.push(args); return dchain; },
        then: (resolve, reject) => Promise.resolve(onDelete ? onDelete(eqArgsList) : { data: null, error: null }).then(resolve, reject),
      };
      return dchain;
    },
    then: (resolve, reject) => Promise.resolve(list ? list() : { data: [], error: null }).then(resolve, reject),
  };
  return c;
}

let personaAvatarSingleResult;
let personaAvatarListResult;
let storeSkillsSingleResult;
const personaAvatarInsertSpy = vi.fn();
const personaAvatarUpdateSpy = vi.fn();
const personaAvatarDeleteSpy = vi.fn();
const pipelineLogInsertSpy = vi.fn();

const storageUploadMock = vi.fn().mockResolvedValue({ error: null });
const storageGetPublicUrlMock = vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.test/permanent-ref.jpg' } });
const storageListMock = vi.fn().mockResolvedValue({ data: [{ name: 'front_123.jpg' }], error: null });
const storageRemoveMock = vi.fn().mockResolvedValue({ error: null });

const fromMock = vi.fn((table) => {
  if (table === 'persona_avatars') {
    return makeTable({
      single: async () => personaAvatarSingleResult,
      list: async () => personaAvatarListResult,
      onInsert: (row) => { personaAvatarInsertSpy(row); return { data: { id: 'new-pa', ...row }, error: null }; },
      onUpdate: (patch, eqArgsList) => { personaAvatarUpdateSpy(patch, eqArgsList); return { data: null, error: null }; },
      onDelete: (eqArgsList) => { personaAvatarDeleteSpy(eqArgsList); return { data: null, error: null }; },
    });
  }
  if (table === 'store_skills') {
    return makeTable({ single: async () => storeSkillsSingleResult });
  }
  if (table === 'pipeline_log') {
    return makeTable({ onInsert: (row) => { pipelineLogInsertSpy(row); return { error: null }; } });
  }
  return makeTable();
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => fromMock(table),
    storage: { from: () => ({ upload: storageUploadMock, getPublicUrl: storageGetPublicUrlMock, list: storageListMock, remove: storageRemoveMock }) },
  }),
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: (...args) => getStoreMock(...args) }));

const submitFalJobMock = vi.fn();
vi.mock('../lib/fal.js', () => ({
  submitFalJob: (...args) => submitFalJobMock(...args),
  checkFalJob: vi.fn(),
}));

vi.mock('../lib/higgsfield.js', () => ({ generateImage: vi.fn() }));

function mockReqRes({ body = {}, query = {}, user } = {}) {
  const req = { body, query, headers: {}, user };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const ADMIN = { role: 'admin', permissions: [], store_access: [] };
const READER = { role: 'member', permissions: ['products:read'], store_access: ['s1'] };
const READER_WRONG_STORE = { role: 'member', permissions: ['products:read'], store_access: ['s2'] };
const GENERATOR = { role: 'member', permissions: ['creatives:generate'], store_access: ['s1'] };
const GENERATOR_WRONG_STORE = { role: 'member', permissions: ['creatives:generate'], store_access: ['s2'] };
const IMAGES_EDITOR = { role: 'member', permissions: ['products:images'], store_access: ['s1'] };
const IMAGES_EDITOR_WRONG_STORE = { role: 'member', permissions: ['products:images'], store_access: ['s2'] };

describe('lib/actions/avatars.js', () => {
  let persona_avatars, generate_avatar, set_avatar_reference, delete_avatar;

  beforeEach(async () => {
    vi.resetModules();
    personaAvatarSingleResult = { data: null, error: null };
    personaAvatarListResult = { data: [], error: null };
    storeSkillsSingleResult = { data: null, error: null };
    personaAvatarInsertSpy.mockClear();
    personaAvatarUpdateSpy.mockClear();
    personaAvatarDeleteSpy.mockClear();
    pipelineLogInsertSpy.mockClear();
    storageUploadMock.mockClear();
    storageListMock.mockClear().mockResolvedValue({ data: [{ name: 'front_123.jpg' }], error: null });
    storageRemoveMock.mockClear();
    getStoreMock.mockReset().mockResolvedValue({ id: 's1', slug: 'test-store', name: 'Test Store' });
    submitFalJobMock.mockReset().mockResolvedValue({ requestId: 'r1', pollBase: 'pb1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');

    const mod = await import('../lib/actions/avatars.js');
    ({ persona_avatars, generate_avatar, set_avatar_reference, delete_avatar } = mod);
  });

  describe('persona_avatars (GET list)', () => {
    it('403s without products:read', async () => {
      const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: { role: 'member', permissions: [], store_access: ['s1'] } });
      await persona_avatars(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('403s with products:read but wrong store_access', async () => {
      const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: READER_WRONG_STORE });
      await persona_avatars(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('200s and returns the list for a permitted member', async () => {
      personaAvatarListResult = { data: [{ id: 'pa1', persona_name: 'Maria' }], error: null };
      const { req, res } = mockReqRes({ query: { store_id: 's1' }, user: READER });
      await persona_avatars(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([{ id: 'pa1', persona_name: 'Maria' }]);
    });
  });

  describe('generate_avatar', () => {
    it('403s without creatives:generate', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', description: 'A friendly mom of two' }, user: READER });
      await generate_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(submitFalJobMock).not.toHaveBeenCalled();
    });

    it('403s with creatives:generate but wrong store_access', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', description: 'A friendly mom of two' }, user: GENERATOR_WRONG_STORE });
      await generate_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('400s when persona_name or description is missing', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria' }, user: GENERATOR });
      await generate_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('404s when the store does not resolve', async () => {
      getStoreMock.mockResolvedValue(null);
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', description: 'A friendly mom of two' }, user: GENERATOR });
      await generate_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('no existing avatar: submits fal.ai TEXT-TO-IMAGE (no /edit suffix, no imageUrl) and INSERTS a new generating row', async () => {
      personaAvatarSingleResult = { data: null, error: null }; // no existing avatar found
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', description: 'A friendly mom of two' }, user: GENERATOR });
      await generate_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(submitFalJobMock).toHaveBeenCalledTimes(1);
      const call = submitFalJobMock.mock.calls[0][0];
      expect(call.model).toBe('fal-ai/nano-banana-pro');
      expect(call.imageUrl).toBeUndefined();
      expect(personaAvatarInsertSpy).toHaveBeenCalledTimes(1);
      const inserted = personaAvatarInsertSpy.mock.calls[0][0];
      expect(inserted).toMatchObject({ store_id: 's1', persona_name: 'Maria', status: 'generating', front_request_id: 'r1', front_poll_base: 'pb1' });
      expect(personaAvatarUpdateSpy).not.toHaveBeenCalled();
    });

    it('existing avatar reference: submits fal.ai EDIT (/edit suffix, imageUrl=existing reference) and UPDATES the row (not insert)', async () => {
      personaAvatarSingleResult = { data: { id: 'pa1', reference_url: 'https://img.test/existing-ref.png' }, error: null };
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', description: 'A friendly mom of two' }, user: GENERATOR });
      await generate_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const call = submitFalJobMock.mock.calls[0][0];
      expect(call.model).toBe('fal-ai/nano-banana-pro/edit');
      expect(call.imageUrl).toBe('https://img.test/existing-ref.png');
      expect(personaAvatarUpdateSpy).toHaveBeenCalledTimes(1);
      const [patch, eqArgsList] = personaAvatarUpdateSpy.mock.calls[0];
      expect(patch).toMatchObject({ status: 'generating', front_request_id: 'r1', front_poll_base: 'pb1' });
      expect(eqArgsList).toEqual([['id', 'pa1']]);
      expect(personaAvatarInsertSpy).not.toHaveBeenCalled();
    });

    it('500s when fal.ai submit rejects', async () => {
      submitFalJobMock.mockRejectedValue(new Error('fal.ai unreachable'));
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', description: 'A friendly mom of two' }, user: GENERATOR });
      await generate_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('500s when fal.ai returns no requestId/pollBase', async () => {
      submitFalJobMock.mockResolvedValue({});
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', description: 'A friendly mom of two' }, user: GENERATOR });
      await generate_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    // NOTE (finding, not fixed here — coverage only): despite lib/higgsfield.js's
    // `generateImage` being imported into this module, generate_avatar has no
    // Higgsfield branch at all — every call routes through fal.ai submitFalJob
    // (edit vs text-to-image is decided purely by whether a reference already
    // exists). The Higgsfield import is dead code. See P1-23 report.
    it('never calls anything Higgsfield-related — routing is fal.ai-only regardless of reference state', async () => {
      const higgsfieldMod = await import('../lib/higgsfield.js');
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', description: 'A friendly mom of two' }, user: GENERATOR });
      await generate_avatar(req, res);
      expect(higgsfieldMod.generateImage).not.toHaveBeenCalled();
    });
  });

  describe('set_avatar_reference', () => {
    it('403s without products:images', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', url: 'https://storage.test/x.jpg' }, user: READER });
      await set_avatar_reference(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('403s with products:images but wrong store_access', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', url: 'https://storage.test/x.jpg' }, user: IMAGES_EDITOR_WRONG_STORE });
      await set_avatar_reference(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('a plain (non-fal.ai) URL is stored as-is — no download/re-upload', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', url: 'https://storage.test/manual-upload.png' }, user: IMAGES_EDITOR });
      await set_avatar_reference(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(fetch).not.toHaveBeenCalled();
      expect(personaAvatarUpdateSpy).toHaveBeenCalledTimes(1);
      const [patch, eqArgsList] = personaAvatarUpdateSpy.mock.calls[0];
      expect(patch).toEqual({ reference_url: 'https://storage.test/manual-upload.png' });
      expect(eqArgsList).toEqual([['store_id', 's1'], ['persona_name', 'Maria']]);
      expect(res.json).toHaveBeenCalledWith({ reference_url: 'https://storage.test/manual-upload.png' });
    });

    it('a temporary fal.ai URL is downloaded and re-uploaded to Storage, and the PERMANENT url is stored', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria', url: 'https://fal.run/tmp/abc123.png' }, user: IMAGES_EDITOR });
      await set_avatar_reference(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(fetch).toHaveBeenCalledWith('https://fal.run/tmp/abc123.png');
      expect(storageUploadMock).toHaveBeenCalledTimes(1);
      const [patch] = personaAvatarUpdateSpy.mock.calls[0];
      expect(patch).toEqual({ reference_url: 'https://storage.test/permanent-ref.jpg' });
      expect(res.json).toHaveBeenCalledWith({ reference_url: 'https://storage.test/permanent-ref.jpg' });
    });
  });

  describe('delete_avatar', () => {
    it('403s without products:images', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria' }, user: READER });
      await delete_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('403s with products:images but wrong store_access', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria' }, user: IMAGES_EDITOR_WRONG_STORE });
      await delete_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('deletes the persona_avatars row scoped to store_id + persona_name, and cleans up Storage', async () => {
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria' }, user: IMAGES_EDITOR });
      await delete_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ deleted: true });

      expect(personaAvatarDeleteSpy).toHaveBeenCalledTimes(1);
      expect(personaAvatarDeleteSpy.mock.calls[0][0]).toEqual([['store_id', 's1'], ['persona_name', 'Maria']]);

      expect(storageListMock).toHaveBeenCalledWith('test-store/Avatars/Maria');
      expect(storageRemoveMock).toHaveBeenCalledWith(['test-store/Avatars/Maria/front_123.jpg']);

      expect(pipelineLogInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ agent: 'AVATAR', store_id: 's1' }));
    });

    it('storage cleanup is best-effort — a Storage list failure does not fail the request (row is already deleted)', async () => {
      storageListMock.mockRejectedValueOnce(new Error('storage down'));
      const { req, res } = mockReqRes({ body: { store_id: 's1', persona_name: 'Maria' }, user: IMAGES_EDITOR });
      await delete_avatar(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(personaAvatarDeleteSpy).toHaveBeenCalledTimes(1);
    });
  });
});

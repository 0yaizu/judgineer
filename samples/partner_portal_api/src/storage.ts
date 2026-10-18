export const db = {
  async query(_sql: string) {
    return [];
  },
};

export const members = {
  async find(id: string) {
    return { id, displayName: "", role: "partner" };
  },
  async save(_member: object) {},
};

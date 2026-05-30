export class TokenBudget {
  private _total: number;
  private _spent: number = 0;

  constructor(total: number) {
    this._total = total;
  }

  get total(): number {
    return this._total;
  }

  spent(): number {
    return this._spent;
  }

  remaining(): number {
    return this._total - this._spent;
  }

  record(tokens: number): void {
    this._spent += tokens;
  }

  isExhausted(): boolean {
    return this._spent >= this._total;
  }

  fraction(): number {
    return this._total > 0 ? this._spent / this._total : 1;
  }

  toJSON(): { total: number; spent: number; remaining: number } {
    return {
      total: this._total,
      spent: this._spent,
      remaining: this.remaining(),
    };
  }
}

import { toTokenAnswer } from './token-answer';

describe('toTokenAnswer', () => {
  it('reads an int64 string', () => {
    expect(
      toTokenAnswer(
        { accessToken: 'a', accessTokenExpiresAt: '1730000900000' },
        1730000000000,
      ),
    ).toEqual({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900 });
  });

  it('never negative', () => {
    expect(
      toTokenAnswer(
        { accessToken: 'a', accessTokenExpiresAt: '1729999000000' },
        1730000000000,
      ).expiresIn,
    ).toBe(0);
  });

  it('reads a number too', () => {
    expect(
      toTokenAnswer(
        { accessToken: 'a', accessTokenExpiresAt: 1730000060000 },
        1730000000000,
      ).expiresIn,
    ).toBe(60);
  });
});

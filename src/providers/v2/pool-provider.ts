import { BigNumber } from '@ethersproject/bignumber';
import { Token } from '@uniswap/sdk-core';
import { Pair } from '@uniswap/v2-sdk';
import { Pool } from '@uniswap/v3-sdk';
import retry, { Options as RetryOptions } from 'async-retry';
import _ from 'lodash';

import { IUniswapV2Pair__factory } from '../../types/v2/factories/IUniswapV2Pair__factory';
import { ChainId, CurrencyAmount } from '../../util';
import { log } from '../../util/log';
import { poolToString } from '../../util/routes';
import { IMulticallProvider, Result } from '../multicall-provider';
import { ProviderConfig } from '../provider';

type IReserves = {
  reserve0: BigNumber;
  reserve1: BigNumber;
  blockTimestampLast: number;
};

/**
 * Provider for getting V2 pools.
 *
 * @export
 * @interface IV2PoolProvider
 */
export interface IV2PoolProvider {
  /**
   * Gets the pools for the specified token pairs.
   *
   * @param tokenPairs The token pairs to get.
   * @param [providerConfig] The provider config.
   * @returns A pool accessor with methods for accessing the pools.
   */
  getPools(
    tokenPairs: [Token, Token][],
    providerConfig?: ProviderConfig
  ): Promise<V2PoolAccessor>;

  /**
   * Gets the pool address for the specified token pair.
   *
   * @param tokenA Token A in the pool.
   * @param tokenB Token B in the pool.
   * @returns The pool address and the two tokens.
   */
  getPoolAddress(
    tokenA: Token,
    tokenB: Token
  ): { poolAddress: string; token0: Token; token1: Token };
}

export type V2PoolAccessor = {
  getPool: (tokenA: Token, tokenB: Token) => Pair | undefined;
  getPoolByAddress: (address: string) => Pair | undefined;
  getAllPools: () => Pair[];
};

export type V2PoolRetryOptions = RetryOptions;

export class V2PoolProvider implements IV2PoolProvider {
  // Computing pool addresses is slow as it requires hashing, encoding etc.
  // Addresses never change so can always be cached.
  private POOL_ADDRESS_CACHE: { [key: string]: string } = {};

  /**
   * Creates an instance of V2PoolProvider.
   * @param chainId The chain id to use.
   * @param multicall2Provider The multicall provider to use to get the pools.
   * @param retryOptions The retry options for each call to the multicall.
   */
  constructor(
    protected chainId: ChainId,
    protected multicall2Provider: IMulticallProvider,
    protected retryOptions: V2PoolRetryOptions = {
      retries: 2,
      minTimeout: 50,
      maxTimeout: 500,
    }
  ) {}

  public async getPools(
    tokenPairs: [Token, Token][],
    providerConfig?: ProviderConfig
  ): Promise<V2PoolAccessor> {
    const poolAddressSet: Set<string> = new Set<string>();
    const sortedTokenPairs: Array<[Token, Token]> = [];
    const sortedPoolAddresses: string[] = [];

    for (const tokenPair of tokenPairs) {
      const [tokenA, tokenB] = tokenPair;

      const { poolAddress, token0, token1 } = this.getPoolAddress(
        tokenA,
        tokenB
      );

      if (poolAddressSet.has(poolAddress)) {
        continue;
      }

      poolAddressSet.add(poolAddress);
      sortedTokenPairs.push([token0, token1]);
      sortedPoolAddresses.push(poolAddress);
    }

    log.debug(
      `getPools called with ${tokenPairs.length} token pairs. Deduped down to ${poolAddressSet.size}`
    );

    // console.log('sortedPoolAddresses',sortedPoolAddresses);

    const reservesResults = await this.getPoolsData<IReserves>(
      sortedPoolAddresses,
      'getReserves',
      providerConfig
    );

    log.info(
      `Got reserves for ${poolAddressSet.size} pools ${
        providerConfig?.blockNumber
          ? `as of block: ${await providerConfig?.blockNumber}.`
          : ``
      }`
    );
    // console.log('reservesResults',reservesResults);

    const poolAddressToPool: { [poolAddress: string]: Pair } = {};

    const invalidPools: [Token, Token][] = [];

    for (let i = 0; i < sortedPoolAddresses.length; i++) {
      const reservesResult = reservesResults[i]!;

      if (!reservesResult?.success) {
        const [token0, token1] = sortedTokenPairs[i]!;
        invalidPools.push([token0, token1]);

        continue;
      }

      const [token0, token1] = sortedTokenPairs[i]!;
      const { reserve0, reserve1 } = reservesResult.result;

      const pool = new Pair(
        CurrencyAmount.fromRawAmount(token0, reserve0.toString()),
        CurrencyAmount.fromRawAmount(token1, reserve1.toString())
      );

      const poolAddress = sortedPoolAddresses[i]!;

      poolAddressToPool[poolAddress] = pool;
    }
    // console.log('invalidPools',invalidPools);

    if (invalidPools.length > 0) {
      log.info(
        {
          invalidPools: _.map(
            invalidPools,
            ([token0, token1]) => `${token0.symbol}/${token1.symbol}`
          ),
        },
        `${invalidPools.length} pools invalid after checking their slot0 and liquidity results. Dropping.`
      );
    }

    // console.log('poolAddressToPool',poolAddressToPool);

    const poolStrs = _.map(Object.values(poolAddressToPool), poolToString);

    log.debug({ poolStrs }, `Found ${poolStrs.length} valid pools`);

    return {
      getPool: (tokenA: Token, tokenB: Token): Pair | undefined => {
        const { poolAddress } = this.getPoolAddress(tokenA, tokenB);
        return poolAddressToPool[poolAddress];
      },
      getPoolByAddress: (address: string): Pair | undefined =>
        poolAddressToPool[address],
      getAllPools: (): Pair[] => Object.values(poolAddressToPool),
    };
  }

  public getPoolAddress(
    tokenA: Token,
    tokenB: Token
  ): { poolAddress: string; token0: Token; token1: Token } {
    const [token0, token1] = tokenA.sortsBefore(tokenB)
      ? [tokenA, tokenB]
      : [tokenB, tokenA];

    const cacheKey = `${this.chainId}/${token0.address}/${token1.address}`;

    const cachedAddress = this.POOL_ADDRESS_CACHE[cacheKey];

    if (cachedAddress) {
      return { poolAddress: cachedAddress, token0, token1 };
    }
    // console.log('pair getPoolAddress token0 ', token0)
    // console.log('pair getPoolAddress token1 ', token1)
    let poolAddress ;

    let initCodeHashManualOverride:string
    let factoryAddressOverride:string
    if(token0.chainId == 55004){
      factoryAddressOverride = '0x8C2351935011CfEccA4Ea08403F127FB782754AC'
      initCodeHashManualOverride = '0xa598dd2fba360510c5a8f02f44423a4468e902df5857dbce3ca162a43a3a31ff'
      poolAddress = Pool.getAddress(token0, token1, 3000, initCodeHashManualOverride, factoryAddressOverride );

    } else if (token0.chainId == 5050){
      factoryAddressOverride = '0x2Ae8FeE7B4f4ef27088fa8a550C91A045A3128b5'
      initCodeHashManualOverride = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
      poolAddress = Pool.getAddress(token0, token1, 3000, initCodeHashManualOverride, factoryAddressOverride );

    } else {
      poolAddress = Pair.getAddress(token0, token1);
    }

    // console.log('pair poolAddress', poolAddress)
    this.POOL_ADDRESS_CACHE[cacheKey] = poolAddress;

    return { poolAddress, token0, token1 };
  }

  private async getPoolsData<TReturn>(
    poolAddresses: string[],
    functionName: string,
    providerConfig?: ProviderConfig
  ): Promise<Result<TReturn>[]> {
    const { results, blockNumber } = await retry(async () => {
      return this.multicall2Provider.callSameFunctionOnMultipleContracts<
        undefined,
        TReturn
      >({
        addresses: poolAddresses,
        contractInterface: IUniswapV2Pair__factory.createInterface(),
        functionName: functionName,
        providerConfig,
      });
    }, this.retryOptions);

    log.debug(`Pool data fetched as of block ${blockNumber}`);

    return results;
  }
}

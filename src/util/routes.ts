import { Protocol } from '@uniswap/router-sdk';
import { Percent } from '@uniswap/sdk-core';
import { Pair } from '@uniswap/v2-sdk';
import { Pool } from '@uniswap/v3-sdk';
import _ from 'lodash';

import { RouteWithValidQuote } from '../routers/alpha-router';
import { MixedRoute, V2Route, V3Route } from '../routers/router';

import { CurrencyAmount } from '.';

export const routeToString = (
  route: V3Route | V2Route | MixedRoute,
  chainId?: number
): string => {
  const routeStr = [];
  const tokens =
    route.protocol === Protocol.V3
      ? route.tokenPath
      : // MixedRoute and V2Route have path
        route.path;

  // console.log('tokens' ,tokens)
  const tokenPath = _.map(tokens, (token) => `${token.symbol}`);
  // console.log('tokenPath' ,tokenPath)

  const pools =
    route.protocol === Protocol.V3 || route.protocol === Protocol.MIXED
      ? route.pools
      : route.pairs;

      // console.log('pools' ,pools)

  let initCodeHashManualOverride:string
  let factoryAddressOverride:string
  if(chainId == 55004){
    factoryAddressOverride = '0x755Ba335013C07CE35C9A2dd5746617Ac4c6c799'
    initCodeHashManualOverride = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
  } else if (chainId == 5050) {
    factoryAddressOverride = '0x2Ae8FeE7B4f4ef27088fa8a550C91A045A3128b5'
    initCodeHashManualOverride = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
  }

  const poolFeePath = _.map(pools, (pool) => {
    // console.log('poolFeePath chainId', chainId)
    return `${
      pool instanceof Pool
        ? ` -- ${pool.fee / 10000}% [${Pool.getAddress(
            pool.token0,
            pool.token1,
            pool.fee,
            initCodeHashManualOverride,
            factoryAddressOverride
          )}]`
        : ` -- [${Pair.getAddress(
            (pool as Pair).token0,
            (pool as Pair).token1
          )}]`
    } --> `;
  });
  // console.log('poolFeePath' ,poolFeePath)
  for (let i = 0; i < tokenPath.length; i++) {
    routeStr.push(tokenPath[i]);
    if (i < poolFeePath.length) {
      routeStr.push(poolFeePath[i]);
    }
  }
  // console.log('routeStr' ,routeStr.join(''))
  return routeStr.join('');
};

export const routeAmountsToString = (
  routeAmounts: RouteWithValidQuote[],
  chainId?: number
): string => {
  const total = _.reduce(
    routeAmounts,
    (total: CurrencyAmount, cur: RouteWithValidQuote) => {
      return total.add(cur.amount);
    },
    CurrencyAmount.fromRawAmount(routeAmounts[0]!.amount.currency, 0)
  );

  const routeStrings = _.map(routeAmounts, ({ protocol, route, amount }) => {
    const portion = amount.divide(total);
    const percent = new Percent(portion.numerator, portion.denominator);
    /// @dev special case for MIXED routes we want to show user friendly V2+V3 instead
    return `[${
      protocol == Protocol.MIXED ? 'V2 + V3' : protocol
    }] ${percent.toFixed(2)}% = ${routeToString(route, chainId)}`;
  });

  return _.join(routeStrings, ', ');
};

export const routeAmountToString = (
  routeAmount: RouteWithValidQuote
): string => {
  const { route, amount } = routeAmount;
  return `${amount.toExact()} = ${routeToString(route)}`;
};

export const poolToString = (p: Pool | Pair): string => {
  return `${p.token0.symbol}/${p.token1.symbol}${
    p instanceof Pool ? `/${p.fee / 10000}%` : ``
  }`;
};

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
  if(chainId == 5050 || chainId == 55004){
    factoryAddressOverride = '0x8C2351935011CfEccA4Ea08403F127FB782754AC'
    initCodeHashManualOverride = '0xa598dd2fba360510c5a8f02f44423a4468e902df5857dbce3ca162a43a3a31ff'
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

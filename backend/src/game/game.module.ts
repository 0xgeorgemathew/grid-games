import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { GameGatewayGateway } from './game.gateway/game.gateway.gateway';

@Module({
  providers: [GameService, GameGatewayGateway]
})
export class GameModule {}
